import type { ItemDef, HairDef } from './types';

// ── Image cache ───────────────────────────────────────────────────────────────
export const imgCache = new Map<string, HTMLImageElement>();
export const hubImgCache = new Map<string, HTMLImageElement>();

export function loadItemImg(name: string, src: string, cache = imgCache): Promise<void> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { cache.set(name, img); resolve(); };
    img.onerror = () => resolve();
    img.src = src;
  });
}

// ── Reference dimensions ──────────────────────────────────────────────────────
export const ROOM_HEAD_W = 14;
export const ROOM_BODY_W = 16;
export const HUB_HEAD_W  = 8;
export const HUB_BODY_W  = 10;

// Extra transparent pixels added to the top of every sprite canvas so tall
// hats never clip. All scenes use setOrigin(0.5, 1) so the bottom anchor
// stays fixed — this headroom is invisible to scene positioning logic.
export const SPRITE_HAT_HEADROOM = 16;
// Extra transparent pixels on each side of the room canvas so wide hats never clip.
// Body drawing uses translated coords (shifted right by this amount) so nothing moves.
export const ROOM_SPRITE_XPAD = 12;

// ── Item definitions ──────────────────────────────────────────────────────────
// anchor:     which body reference point the item attaches to
// widthRatio: fraction of that anchor's reference width (headW for head anchors, bodyW for body anchors)
// above:      true = image extends ABOVE anchor (hats), false = image starts AT/BELOW anchor
// yGap:       room-scale px. If above: distance from image bottom to anchor. If below: offset from anchor to image top.
export const ITEM_DEFS: Record<string, ItemDef> = {
  // ── Hats ──
  wizard:             { anchor: 'headTop', widthRatio: 1.8, roomWidthRatio: 1.5, above: true, yGap: -5, hubYGap: 2, hubFlipH: true },
  ostrichhat:         { anchor: 'headTop', widthRatio: 1.875, roomWidthRatio: 1.68, above: true, yGap: -6, hubYGap: 2, flipH: true, xOffset: -1, tintDark: true },
  crown:              { anchor: 'headTop', widthRatio: 1.0, roomWidthRatio: 1.0, above: true, yGap: -4, hubYGap: 1, noTint: true, naturalSize: true },
  crown_purple:       { anchor: 'headTop', widthRatio: 1.0, roomWidthRatio: 1.0, above: true, yGap: -4, hubYGap: 1, noTint: true, naturalSize: true },
  crown_silver:       { anchor: 'headTop', widthRatio: 1.0, roomWidthRatio: 1.0, above: true, yGap: -4, hubYGap: 1, noTint: true, naturalSize: true },
  crown_bronze:       { anchor: 'headTop', widthRatio: 1.0, roomWidthRatio: 1.0, above: true, yGap: -4, hubYGap: 1, noTint: true, naturalSize: true },
  fishhat:            { anchor: 'headTop', widthRatio: 1.4, roomWidthRatio: 1.2, above: true, yGap: -6, hubYGap: 1, noTint: true, naturalSize: true },
  // ── Accessories (image-based) ──
  halo:               { anchor: 'headTop', widthRatio: 1.0, roomWidthRatio: 1.0,  above: true, yGap:  2, hubYGap: 11 },
  catears:            { anchor: 'headTop', widthRatio: 1.0, roomWidthRatio: 1.0,  above: true, yGap: -5, hubYGap:  4 },
  headphones:         { anchor: 'headTop', widthRatio: 2.0,  roomWidthRatio: 1.43, hubSrc: 'assets/hats/headphoneshub.png', above: true, yGap: -8, hubYGap: -4 },
  horns:              { anchor: 'headTop', widthRatio: 1.43,   roomWidthRatio: 1.3, above: true, yGap: -4, hubYGap:  4 },
  hornsspiral:        { anchor: 'headTop', widthRatio: 1.0,  above: true, yGap: -3, roomYGap: -4, hubYGap: 4 },
  knightsheadband:    { anchor: 'headTop', widthRatio: 1.0,  above: false, yGap: 2, roomYGap: 2, hubYGap: -2, naturalSize: true },
  // ── Accessories ──  (add image-based accessories here)
  // ── Tops ──        (add image-based tops here)
  // ── Bottoms ──     (add image-based bottoms here)
};

// ── Hair definitions ──────────────────────────────────────────────────────────
// Hub coords  (origin = head center cx, head top hy):
//   hubOffX   negative = left of center, positive = right       (cx + hubOffX = image left edge)
//   hubOffY   negative = above head top, positive = below        (hy + hubOffY = image top edge)
//   hubW/H    width and height in pixels, always positive
//
// Room coords  (origin = canvas left 0, head top oY):
//   roomX     absolute left edge of image — smaller = further left
//   roomY     negative = above head top, positive = below        (oY + roomY = image top edge)
//   roomW/H   width and height in pixels, always positive
//
// Hat variants (hatHubOffX/Y, hatRoomX/Y) follow the same rules —
// used instead of the main coords when a hat is worn.
export const HAIR_DEFS: Record<string, HairDef> = {
  short:    { roomKey: 'hair_short',    roomX: 4,  roomY: -3,  roomW: 16, roomH: 7,  hubKey: 'hair_short_hub',    hubOffX: -5,  hubOffY: -2, hubW: 10, hubH: 4  },
  afro:     { roomKey: 'hair_afro',     roomX: 1,  roomY: -7,  roomW: 22, roomH: 15, hubKey: 'hair_afro_hub',     hubOffX: -8,  hubOffY: -6, hubW: 16, hubH: 12 },
  ponytail: { roomKey: 'hair_ponytail', roomX: 0,  roomY: -7,  roomW: 20, roomH: 14, hubKey: 'hair_ponytail_hub', hubOffX: -7,  hubOffY: -6, hubW: 13, hubH: 11, flipH: true },
  bun:      { roomKey: 'hair_bun',      roomX: 5,  roomY: -6, roomW: 14, roomH: 11, hubKey: 'hair_bun_hub',      hubOffX: -5,  hubOffY: -4, hubW: 10, hubH: 7  },
  grease:   { roomKey: 'hair_grease',   roomX: 0,  roomY: -3, roomW: 19, roomH: 10, hubKey: 'hair_grease_hub',   hubOffX: -8,  hubOffY: -3, hubW: 13, hubH: 6  },
  swept:    { roomKey: 'hair_swept',    roomX: 4,  roomY: -6, roomW: 17, roomH: 13, hubKey: 'hair_swept_hub',    hubOffX: -6,  hubOffY: -5, hubW: 13, hubH: 9  },
  pigtails: { roomKey: 'hair_pigtails', roomX: -2, roomY: -5, roomW: 28, roomH: 16, hubKey: 'hair_pigtails_hub', hubOffX: -10, hubOffY: -2, hubW: 20, hubH: 8  },
  long:     { roomKey: 'hair_long',     roomX: 5,  roomY: -2, roomW: 14, roomH: 16, hubKey: 'hair_long_hub',     hubOffX: -5,  hubOffY: -2, hubW: 10, hubH: 11, flipH: true,
             hatRoomKey: 'hair_longhat',    hatRoomX: 5,  hatRoomY: 2, hatRoomW: 14, hatRoomH: 12,
             hatHubKey:  'hair_longhubhat', hatHubOffX: -5, hatHubOffY: 2, hatHubW: 10, hatHubH: 7 },
  spiky:     { roomKey: 'hair_spiky',     roomX: 1,  roomY: -5, roomW: 22, roomH: 13, hubKey: 'hair_spiky_hub',     hubOffX: -7,  hubOffY: -4, hubW: 14, hubH: 10 },
  horseshoe: { roomKey: 'hair_horseshoe', roomX: 5,  roomY: 1, roomW: 14, roomH: 4,  hubKey: 'hair_horseshoe_hub', hubOffX: -5,  hubOffY: 0, hubW: 10, hubH: 3  },
  part:      { roomKey: 'hair_part',      roomX: 5,  roomY: -2, roomW: 14, roomH: 7,  hubKey: 'hair_part_hub',      hubOffX: -5,  hubOffY: -1, hubW: 10, hubH: 4  },
  partbeard: { roomKey: 'hair_partbeard', roomX: 5,  roomY: -2, roomW: 14, roomH: 16, hubKey: 'hair_partbeard_hub', hubOffX: -5,  hubOffY: -1, hubW: 10, hubH: 11,
               hatRoomKey: 'hair_partbeardhat',    hatRoomX: 5,  hatRoomY: 2, hatRoomW: 14, hatRoomH: 12,
               hatHubKey:  'hair_partbeardhubhat', hatHubOffX: -5, hatHubOffY: 2, hatHubW: 10, hatHubH: 8 },
  braid:     { roomKey: 'hair_braid',     roomX: 4,  roomY: -3, roomW: 16, roomH: 17, hubKey: 'hair_braid_hub',     hubOffX: -5,  hubOffY: -2, hubW: 10, hubH: 11,
               hatRoomKey: 'hair_braidhat',    hatRoomX: 4,  hatRoomY: 3, hatRoomW: 15, hatRoomH: 11,
               hatHubKey:  'hair_braidhubhat', hatHubOffX: -5, hatHubOffY: 2, hatHubW: 10, hatHubH: 7 },
};

// ── Asset loading ─────────────────────────────────────────────────────────────
export const itemImagesReady = Promise.all([
  loadItemImg('wizard',               'assets/hats/wizardhat.png'),
  loadItemImg('wizard',               'assets/hats/wizardhathub.png', hubImgCache),
  loadItemImg('halo',                 'assets/hats/haloroom.png'),
  loadItemImg('halo',                 'assets/hats/halo.png', hubImgCache),
  loadItemImg('catears',              'assets/hats/catears.png'),
  loadItemImg('headphones',           'assets/hats/headphones.png'),
  loadItemImg('baseballcap',          'assets/hats/baseballcap.png'),
  loadItemImg('baseballcapbackwards', 'assets/hats/baseballcapbackwards.png'),
  loadItemImg('ostrichhat',           'assets/hats/ostrichhat.png'),
  loadItemImg('horns',                'assets/hats/horns.png'),
  loadItemImg('hornsspiral',          'assets/hats/hornsspiral.png'),
  loadItemImg('crown',                'assets/hats/crown.png'),
  loadItemImg('crown_purple',         'assets/hats/crown_purple.png'),
  loadItemImg('crown_silver',         'assets/hats/crown_silver.png'),
  loadItemImg('crown_bronze',         'assets/hats/crown_bronze.png'),
  // hub-scale variants (designed for the smaller 8px head)
  loadItemImg('headphones',   'assets/hats/headphoneshub.png',   hubImgCache),
  loadItemImg('ostrichhat',   'assets/hats/ostrichhathub.png',   hubImgCache),
  loadItemImg('horns',        'assets/hats/hornshub.png',        hubImgCache),
  loadItemImg('hornsspiral',  'assets/hats/hornsspiralhub.png',  hubImgCache),
  loadItemImg('crown',        'assets/hats/crownhub.png',        hubImgCache),
  loadItemImg('crown_purple', 'assets/hats/crownhub_purple.png', hubImgCache),
  loadItemImg('crown_silver', 'assets/hats/crownhub_silver.png', hubImgCache),
  loadItemImg('crown_bronze', 'assets/hats/crownhub_bronze.png', hubImgCache),
  // hair image overrides
  loadItemImg('hair_short',       'assets/hair/short.png'),
  loadItemImg('hair_short_hub',   'assets/hair/shorthub.png'),
  loadItemImg('hair_afro',        'assets/hair/afro.png'),
  loadItemImg('hair_afro_hub',    'assets/hair/afrohub.png'),
  loadItemImg('hair_ponytail',    'assets/hair/ponytail.png'),
  loadItemImg('hair_ponytail_hub','assets/hair/ponytailhub.png'),
  loadItemImg('hair_bun',         'assets/hair/bun.png'),
  loadItemImg('hair_bun_hub',     'assets/hair/bunhub.png'),
  loadItemImg('hair_grease',      'assets/hair/grease.png'),
  loadItemImg('hair_grease_hub',  'assets/hair/greasehub.png'),
  loadItemImg('hair_swept',       'assets/hair/swept.png'),
  loadItemImg('hair_swept_hub',   'assets/hair/swepthub.png'),
  loadItemImg('hair_pigtails',    'assets/hair/pigtails.png'),
  loadItemImg('hair_pigtails_hub','assets/hair/pigtailshub.png'),
  loadItemImg('hair_long',        'assets/hair/long.png'),
  loadItemImg('hair_long_hub',    'assets/hair/longhub.png'),
  loadItemImg('hair_longhat',     'assets/hair/longhat.png'),
  loadItemImg('hair_longhubhat',  'assets/hair/longhubhat.png'),
  loadItemImg('hair_spiky',            'assets/hair/spiky.png'),
  loadItemImg('hair_spiky_hub',        'assets/hair/spikyhub.png'),
  loadItemImg('hair_horseshoe',        'assets/hair/Horseshoe.png'),
  loadItemImg('hair_horseshoe_hub',    'assets/hair/Horseshoehub.png'),
  loadItemImg('hair_part',             'assets/hair/part.png'),
  loadItemImg('hair_part_hub',         'assets/hair/parthub.png'),
  loadItemImg('hair_partbeard',        'assets/hair/partbeard.png'),
  loadItemImg('hair_partbeard_hub',    'assets/hair/partbeardhub.png'),
  loadItemImg('hair_partbeardhat',     'assets/hair/partbeardhat.png'),
  loadItemImg('hair_partbeardhubhat',  'assets/hair/partbeardhubhat.png'),
  loadItemImg('hair_braid',        'assets/hair/braid.png'),
  loadItemImg('hair_braid_hub',    'assets/hair/braidhub.png'),
  loadItemImg('hair_braidhat',     'assets/hair/braidhat.png'),
  loadItemImg('hair_braidhubhat',  'assets/hair/braidhubhat.png'),
  // body base sprites
  loadItemImg('body_room',   'assets/body/body.png'),
  loadItemImg('body_hub',    'assets/body/bodyhub.png'),
  loadItemImg('body_hub_1',  'assets/body/bodyhub1.png'),
  loadItemImg('body_hub_2',  'assets/body/bodyhub2.png'),
  loadItemImg('body_hub_3',  'assets/body/bodyhub3.png'),
  loadItemImg('body_hub_4',  'assets/body/bodyhub4.png'),
  loadItemImg('body_room_1', 'assets/body/body1.png'),
  loadItemImg('body_room_2', 'assets/body/body2.png'),
  loadItemImg('body_room_3', 'assets/body/body3.png'),
  loadItemImg('body_room_4', 'assets/body/body4.png'),
  // top detail overlays
  loadItemImg('top_jacket_hub',      'assets/tops/jackethub.png'),
  loadItemImg('top_jacket_room',     'assets/tops/jacket.png'),
  loadItemImg('top_bomber_hub',      'assets/tops/bomberhub.png'),
  loadItemImg('top_flannel_hub',     'assets/tops/flanelhub.png'),
  loadItemImg('top_robe_hub',        'assets/tops/wizardrobehub.png'),
  loadItemImg('top_ostrichshirt_hub', 'assets/tops/ostirchshirthub.png'),
  loadItemImg('top_bitcoinshirt_hub', 'assets/tops/Bitcoinshirthub.png'),
  loadItemImg('top_camoshirt_hub',    'assets/tops/camoshirthub.png'),
  loadItemImg('top_tunic_hub',        'assets/tops/tunichub.png'),
  loadItemImg('top_skindress_hub',    'assets/tops/skindresshub.png'),
  loadItemImg('top_knightchest_hub',  'assets/bottoms/knightchesthub.png'),
  loadItemImg('top_bomber_room',      'assets/tops/bomber.png'),
  loadItemImg('top_flannel_room',     'assets/tops/flanel.png'),
  loadItemImg('top_robe_room',        'assets/tops/wizardrobe.png'),
  loadItemImg('top_ostrichshirt_room','assets/tops/ostirchshirt.png'),
  loadItemImg('top_bitcoinshirt_room','assets/tops/Bitcoinshirt.png'),
  loadItemImg('top_camoshirt_room',   'assets/tops/camoshirt.png'),
  loadItemImg('top_tunic_room',       'assets/tops/tunic.png'),
  loadItemImg('top_skindress_room',   'assets/tops/skindress.png'),
  loadItemImg('top_knightchest_room', 'assets/bottoms/knightchest.png'),
  // wings (drawn behind player)
  loadItemImg('acc_wings_hub',  'assets/accessories/wingshub.png'),
  loadItemImg('acc_wings_room', 'assets/accessories/wings.png'),
  loadItemImg('acc_cape_hub',             'assets/accessories/capehub.png'),
  loadItemImg('acc_cape_room',            'assets/accessories/cape.png'),
  loadItemImg('acc_sword_hub',            'assets/accessories/swordhub.png'),
  loadItemImg('acc_sword_room',           'assets/accessories/sword.png'),
  loadItemImg('acc_ostirchfloatie_hub',   'assets/accessories/ostirchfloatiehub.png'),
  loadItemImg('acc_ostirchfloatie_room',  'assets/accessories/ostirchfloatie.png'),
  loadItemImg('acc_ballon_hub',              'assets/accessories/ballonhub.png'),
  loadItemImg('acc_ballon_room',             'assets/accessories/ballon.png'),
  loadItemImg('acc_ballonbitcoin_hub',       'assets/accessories/ballonbitcoinhub.png'),
  loadItemImg('acc_ballonbitcoin_room',      'assets/accessories/ballonbitcoin.png'),
  loadItemImg('acc_ballonostrich_hub',       'assets/accessories/ballonostrichhub.png'),
  loadItemImg('acc_ballonostrich_room',      'assets/accessories/ballonostrich.png'),
  // fish hat
  loadItemImg('fishhat', 'assets/hats/fishhat.png'),
  loadItemImg('fishhat', 'assets/hats/fishhathub.png', hubImgCache),
  // fish net bottoms (single static PNG per scale — all walk frames use same image)
  loadItemImg('bottom_fishnet_hub_1', 'assets/bottoms/fishnethub.png'),
  loadItemImg('bottom_fishnet_hub_2', 'assets/bottoms/fishnethub.png'),
  loadItemImg('bottom_fishnet_hub_3', 'assets/bottoms/fishnethub.png'),
  loadItemImg('bottom_fishnet_hub_4', 'assets/bottoms/fishnethub.png'),
  loadItemImg('bottom_fishnet_room_1', 'assets/bottoms/fishnet.png'),
  loadItemImg('bottom_fishnet_room_2', 'assets/bottoms/fishnet.png'),
  loadItemImg('bottom_fishnet_room_3', 'assets/bottoms/fishnet.png'),
  loadItemImg('bottom_fishnet_room_4', 'assets/bottoms/fishnet.png'),
  // cargo pants walk frames
  loadItemImg('bottom_cargopants_hub_1', 'assets/bottoms/cargopantshub1.png'),
  loadItemImg('bottom_cargopants_hub_2', 'assets/bottoms/cargopantshub2.png'),
  loadItemImg('bottom_cargopants_hub_3', 'assets/bottoms/cargopantshub3.png'),
  loadItemImg('bottom_cargopants_hub_4', 'assets/bottoms/cargopantshub4.png'),
  loadItemImg('bottom_cargopants_room_1', 'assets/bottoms/cargopants1.png'),
  loadItemImg('bottom_cargopants_room_2', 'assets/bottoms/cargopants2.png'),
  loadItemImg('bottom_cargopants_room_3', 'assets/bottoms/cargopants3.png'),
  loadItemImg('bottom_cargopants_room_4', 'assets/bottoms/cargopants4.png'),
  // camo pants walk frames
  loadItemImg('bottom_camopants_hub_1', 'assets/bottoms/camopantshub1.png'),
  loadItemImg('bottom_camopants_hub_2', 'assets/bottoms/camopantshub2.png'),
  loadItemImg('bottom_camopants_hub_3', 'assets/bottoms/camopantshub3.png'),
  loadItemImg('bottom_camopants_hub_4', 'assets/bottoms/camopantshub4.png'),
  loadItemImg('bottom_camopants_room_1', 'assets/bottoms/camopants1.png'),
  loadItemImg('bottom_camopants_room_2', 'assets/bottoms/camopants2.png'),
  loadItemImg('bottom_camopants_room_3', 'assets/bottoms/camopants3.png'),
  loadItemImg('bottom_camopants_room_4', 'assets/bottoms/camopants4.png'),
  loadItemImg('bottom_jeans_hub_1', 'assets/bottoms/jeanshub1.png'),
  loadItemImg('bottom_jeans_hub_2', 'assets/bottoms/jeanshub2.png'),
  loadItemImg('bottom_jeans_hub_3', 'assets/bottoms/jeanshub3.png'),
  loadItemImg('bottom_jeans_hub_4', 'assets/bottoms/jeanshub4.png'),
  loadItemImg('bottom_jeans_room_1', 'assets/bottoms/jeans1.png'),
  loadItemImg('bottom_jeans_room_2', 'assets/bottoms/jeans2.png'),
  loadItemImg('bottom_jeans_room_3', 'assets/bottoms/jeans3.png'),
  loadItemImg('bottom_jeans_room_4', 'assets/bottoms/jeans4.png'),
  // baggy jeans walk frames
  loadItemImg('bottom_baggyjeans_hub_1', 'assets/bottoms/baggyjeanshub1.png'),
  loadItemImg('bottom_baggyjeans_hub_2', 'assets/bottoms/baggyjeanshub2.png'),
  loadItemImg('bottom_baggyjeans_hub_3', 'assets/bottoms/baggyjeanshub3.png'),
  loadItemImg('bottom_baggyjeans_hub_4', 'assets/bottoms/baggyjeanshub4.png'),
  loadItemImg('bottom_baggyjeans_room_1', 'assets/bottoms/baggyjeans1.png'),
  loadItemImg('bottom_baggyjeans_room_2', 'assets/bottoms/baggyjeans2.png'),
  loadItemImg('bottom_baggyjeans_room_3', 'assets/bottoms/baggyjeans3.png'),
  loadItemImg('bottom_baggyjeans_room_4', 'assets/bottoms/baggyjeans4.png'),
  // trousers walk frames
  loadItemImg('bottom_trousers_hub_1', 'assets/bottoms/trousershub1.png'),
  loadItemImg('bottom_trousers_hub_2', 'assets/bottoms/trousershub2.png'),
  loadItemImg('bottom_trousers_hub_3', 'assets/bottoms/trousershub3.png'),
  loadItemImg('bottom_trousers_hub_4', 'assets/bottoms/trousershub4.png'),
  loadItemImg('bottom_trousers_room_1', 'assets/bottoms/trousers1.png'),
  loadItemImg('bottom_trousers_room_2', 'assets/bottoms/trousers2.png'),
  loadItemImg('bottom_trousers_room_3', 'assets/bottoms/trousers3.png'),
  loadItemImg('bottom_trousers_room_4', 'assets/bottoms/trousers4.png'),
  // utility pants walk frames
  loadItemImg('bottom_utilitypants_hub_1', 'assets/bottoms/utilitypantshub1.png'),
  loadItemImg('bottom_utilitypants_hub_2', 'assets/bottoms/utilitypantshub2.png'),
  loadItemImg('bottom_utilitypants_hub_3', 'assets/bottoms/utilitypantshub3.png'),
  loadItemImg('bottom_utilitypants_hub_4', 'assets/bottoms/utilitypantshub4.png'),
  loadItemImg('bottom_utilitypants_room_1', 'assets/bottoms/utilitypants1.png'),
  loadItemImg('bottom_utilitypants_room_2', 'assets/bottoms/utilitypants2.png'),
  loadItemImg('bottom_utilitypants_room_3', 'assets/bottoms/utilitypants3.png'),
  loadItemImg('bottom_utilitypants_room_4', 'assets/bottoms/utilitypants4.png'),
  // knight headband
  loadItemImg('knightsheadband',         'assets/hats/knightsheadband.png'),
  loadItemImg('knightsheadband',         'assets/hats/knightsheadbandhub.png', hubImgCache),
  // knight pants walk frames
  loadItemImg('bottom_knightpants_hub_1', 'assets/bottoms/knightpantshub1.png'),
  loadItemImg('bottom_knightpants_hub_2', 'assets/bottoms/knightpantshub2.png'),
  loadItemImg('bottom_knightpants_hub_3', 'assets/bottoms/knightpantshub3.png'),
  loadItemImg('bottom_knightpants_hub_4', 'assets/bottoms/knightpantshub4.png'),
  loadItemImg('bottom_knightpants_room_1', 'assets/bottoms/knightpants1.png'),
  loadItemImg('bottom_knightpants_room_2', 'assets/bottoms/knightpants2.png'),
  loadItemImg('bottom_knightpants_room_3', 'assets/bottoms/knightpants3.png'),
  loadItemImg('bottom_knightpants_room_4', 'assets/bottoms/knightpants4.png'),
]);

// Kept for backward compatibility
export const hatImagesReady = itemImagesReady;
