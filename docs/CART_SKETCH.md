# Shopping Cart — Design Sketch

Not implemented. Captured here so the design isn't lost if you decide to
build it later.

## Why it might be worth it

- One Lightning payment instead of N. Lower fees per item on bulk buys.
- One signer prompt for the whole cart.
- One kind:9735 receipt covers everything (atomic — partial-failure
  isn't possible at the LN layer).

## Why you might skip it

- Adds real UI surface (cart drawer, badge, two buttons per item).
- Only pays off if users actually buy 2+ items per visit. If most
  purchases are single items, per-item flow is fine.

---

## Data model

Module-level in [MarketPanel.ts](../src/ui/MarketPanel.ts):

```ts
private static _cart: MarketItem[] = [];
```

**No localStorage.** Clears on: panel close, logout, successful checkout,
"clear cart" button. No persistence → no abandoned-cart cleanup needed.

## UI changes (MarketPanel.ts)

- **Item card buttons:** swap `Buy` → `+ Cart` (adds) AND keep quick-`Buy`
  (current single-item flow, useful for one-off purchases).
- **Cart badge in header:** `🛒 N · ~M sats` showing item count + total.
  Click opens cart drawer.
- **Cart drawer:** list of items with `✕` remove, running total, single
  `Checkout` button. Empty state: "Cart is empty".
- **Already owned items:** greyed out, "Already owned" instead of
  Buy/+Cart.
- **Already in cart:** button shows "In Cart ✓", click removes.

## Checkout flow

Extend [zapService.ts `payLightningAddress`](../src/nostr/zapService.ts):

```ts
// Signature: item?: ItemMeta → items?: ItemMeta[]
const zapReq = {
  kind: 9734,
  content: items.length === 1
    ? `market-purchase:${items[0].name}`
    : `market-cart:${items.length} items`,
  tags: [
    ['p', storeNostrPubkey],
    ['amount', String(totalMsats)],
    ['lnurl', lnurlData.callback],
    ['relays', ...RELAYS],
    ...items.map(i => ['item', i.id, i.slot, i.value]),
  ],
};
```

Single payment = single bolt11 = single kind:9735 receipt covering
everything.

## Receipt parsing

One-line change in [nostrService.ts `fetchReceiptInventory`](../src/nostr/nostrService.ts):

```ts
// Before:
const itemTag = zapReq.tags?.find((t: string[]) => t[0] === 'item');
if (itemTag?.[2] && itemTag?.[3]) items.push(`${itemTag[2]}:${itemTag[3]}`);

// After:
const itemTags = zapReq.tags?.filter((t: string[]) => t[0] === 'item') ?? [];
for (const t of itemTags) {
  if (t[2] && t[3]) items.push(`${t[2]}:${t[3]}`);
}
```

**Backward compatible** — old single-item receipts still grant
correctly (filter returns an array of length 1).

## Edge cases worth thinking about

- **Spark wallet balance vs cart total** — `sparkCanCover(totalSats)`
  check is the same, just a bigger number. Fine.
- **LN max-sendable** — Blitz's `maxSendable: 10_000_000_000 msats`
  = 10M sats. A 20-item cart at $0.50 each ≈ 64,800 sats. Plenty of
  headroom.
- **Item ordering** — receipt's `item` tags are an array; preserve cart
  insertion order for predictable behavior.
- **Auto-equip** — single purchases currently auto-equip. With a
  multi-item cart, skip auto-equip (or equip first only). Simplest:
  skip auto-equip when cart > 1, open the wardrobe after instead.
- **Partial failure** — can't happen; one bolt11 = atomic. No
  partial-credit handling needed.
- **Item already owned at checkout time** — defensive: filter cart
  against `isOwned()` right before building the zap request, in case
  the user owned the item via another path between adding and
  checking out.

## Estimated scope

- ~150 lines in [MarketPanel.ts](../src/ui/MarketPanel.ts) (cart state
  + drawer UI + button changes)
- ~5 lines each in [zapService.ts](../src/nostr/zapService.ts) and
  [nostrService.ts](../src/nostr/nostrService.ts)
- Zero data migration. Existing receipts keep working.

## Decision triggers

Build it if any of these:

- Telemetry / observation shows users buying 2+ items per session
  regularly.
- Players ask for it.
- A planned shop expansion (bundles, themed sets) would benefit from
  bulk buying.

Skip otherwise — single-item flow is already good.
