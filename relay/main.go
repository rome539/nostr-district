// nd-relay — the Nostr District relay (wss://nostr.thedistrict.online).
//
// Allowlist relay: accepts ONLY district events, rejects everything else.
// Runs on the DO droplet (159.65.226.178) as systemd unit `nd-relay`,
// khatru + pure-Go badger (CGO-free), behind Caddy TLS.
//
// v2 policy (2026-07-03): in addition to the bazaar economy events, accept
// ONE kind of user app-data: the NIP-44 self-encrypted Spark wallet mnemonic
// backup (kind:30078, d exactly `nostr-district:spark-mnemonic`). Rationale:
// public relays keep dying (damus RIP 2026-07); the one relay we control
// should anchor the data users can least afford to lose. The relay only ever
// sees ciphertext. Everything else stays bazaar-only, as v1.
//
// Env:
//   ND_LISTEN          listen address        (default 127.0.0.1:8080)
//   ND_DATA            badger data dir       (default /opt/nd-relay/data)
//   ND_ORACLE_PUBKEYS  comma-separated hex pubkeys; when set, oracle-signed
//                      economy tags (nditem/ndwin/ndbounty/ndfishrec/ndweekly)
//                      are rejected unless authored by one of these keys.
//
// Build (from rome's Mac):  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o nd-relay-bin .
// Deploy: scp nd-relay-bin droplet:/usr/local/bin/nd-relay && systemctl restart nd-relay
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/fiatjaf/eventstore/badger"
	"github.com/fiatjaf/khatru"
	"github.com/fiatjaf/khatru/policies"
	"github.com/nbd-wtf/go-nostr"
)

// Economy tags minted by the oracle — forgery-walled when ND_ORACLE_PUBKEYS is set.
var oracleTags = map[string]bool{
	"nditem": true, "ndwin": true, "ndbounty": true, "ndfishrec": true, "ndweekly": true,
}

// Economy tags signed by players themselves.
var userTags = map[string]bool{
	"ndmarket": true, "ndbid": true, "ndbiddecline": true, "ndfish": true,
}

// How far ahead of our clock an event may be dated. Generous enough for a badly
// set client clock, tight enough that nobody can park an unreplaceable listing.
const maxFutureDrift = nostr.Timestamp(15 * 60)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	oraclePubkeys := map[string]bool{}
	for _, pk := range strings.Split(os.Getenv("ND_ORACLE_PUBKEYS"), ",") {
		if pk = strings.TrimSpace(strings.ToLower(pk)); pk != "" {
			oraclePubkeys[pk] = true
		}
	}
	// Fail CLOSED. This guard used to be skipped entirely when the env var was
	// unset, which meant the one relay we control would store and rebroadcast
	// anyone's forged nditem/ndwin/ndbounty as canonical economy truth — the
	// exact thing the allowlist exists to prevent. An unconfigured relay is a
	// misconfiguration, not a reason to trust everybody.
	if len(oraclePubkeys) == 0 {
		fmt.Fprintln(os.Stderr, "ND_ORACLE_PUBKEYS is unset — refusing to start: "+
			"oracle-signed economy events would be unauthenticated. "+
			"Set it to the oracle pubkey(s) (comma-separated hex).")
		os.Exit(1)
	}

	relay := khatru.NewRelay()
	relay.Info.Name = "Nostr District Relay"
	relay.Info.Description = "District events only: bazaar economy + citizens' own app data."
	relay.Info.Software = "khatru"

	db := &badger.BadgerBackend{Path: env("ND_DATA", "/opt/nd-relay/data")}
	if err := db.Init(); err != nil {
		fmt.Fprintln(os.Stderr, "badger init:", err)
		os.Exit(1)
	}
	relay.StoreEvent = append(relay.StoreEvent, db.SaveEvent)
	relay.QueryEvents = append(relay.QueryEvents, db.QueryEvents)
	relay.DeleteEvent = append(relay.DeleteEvent, db.DeleteEvent)
	// NIP-33 newest-wins per (kind, pubkey, d) — burns supersede items, kills
	// ghost listings/bids.
	relay.ReplaceEvent = append(relay.ReplaceEvent, db.ReplaceEvent)

	// Rate limits. Writes here are cheap for a client and permanent for us — an
	// unthrottled loop fills the droplet's disk. Limits are well above what the
	// game generates in normal play (a burst of inventory writes on login, then
	// occasional trades), so they only bite on abuse.
	relay.RejectConnection = append(relay.RejectConnection,
		policies.ConnectionRateLimiter(8, time.Minute, 16))
	relay.RejectFilter = append(relay.RejectFilter,
		policies.FilterIPRateLimiter(60, time.Minute, 120))
	relay.RejectEvent = append(relay.RejectEvent,
		policies.EventIPRateLimiter(40, time.Minute, 80),
		// Timestamp window, checked before anything else. Replacement here is
		// newest-wins, so a listing dated years ahead can never be superseded —
		// its burn tombstone and every later edit lose the comparison forever.
		// Only the future is bounded: a past-dated event simply loses the
		// comparison, and the backfill tool legitimately republishes old events.
		func(ctx context.Context, event *nostr.Event) (bool, string) {
			if event.CreatedAt > nostr.Now()+maxFutureDrift {
				return true, "invalid: created_at is too far in the future"
			}
			return false, ""
		},
		func(ctx context.Context, event *nostr.Event) (bool, string) {
			tTag := event.Tags.GetFirst([]string{"t"})
			t := ""
			if tTag != nil {
				t = tTag.Value()
			}

			switch event.Kind {
			case 30402:
				if t == "ndmarket" {
					logAccept(event, t)
					return false, ""
				}

			case 30078:
				if userTags[t] {
					logAccept(event, t)
					return false, ""
				}
				if oracleTags[t] {
					if !oraclePubkeys[strings.ToLower(event.PubKey)] {
						return true, "blocked: oracle-signed tag from non-oracle key"
					}
					logAccept(event, t)
					return false, ""
				}
				// v2: the Spark wallet mnemonic backup — NIP-44 self-encrypted
				// by the client, the relay only ever sees ciphertext. Exact
				// d-tag match; no other app-data is accepted.
				dTag := event.Tags.GetFirst([]string{"d"})
				if dTag != nil && dTag.Value() == "nostr-district:spark-mnemonic" {
					logAccept(event, "spark-mnemonic-backup")
					return false, ""
				}

			case 0:
				// Oracle profile only (public relays carry everyone else's).
				if oraclePubkeys[strings.ToLower(event.PubKey)] {
					return false, ""
				}
			}

			return true, "blocked: not a district event"
		},
	)

	addr := env("ND_LISTEN", "127.0.0.1:8080")
	fmt.Println("nd-relay v2 listening on", addr)
	if err := http.ListenAndServe(addr, relay); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func logAccept(event *nostr.Event, label string) {
	fmt.Printf("ACCEPTED kind:%d %s author=%s d=%s\n",
		event.Kind, label, event.PubKey[:8], firstTag(event, "d"))
}

func firstTag(event *nostr.Event, name string) string {
	if tag := event.Tags.GetFirst([]string{name}); tag != nil {
		return tag.Value()
	}
	return ""
}
