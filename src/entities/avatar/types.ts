export type AnchorType = 'headTop' | 'eyeLine' | 'mouthLine' | 'neckLine' | 'shoulder' | 'waist';

export interface ItemDef {
  anchor: AnchorType;
  widthRatio: number;
  roomWidthRatio?: number;
  hubSrc?: string;
  above: boolean;
  yGap: number;
  roomYGap?: number;
  hubYGap?: number;
  flipH?: boolean;
  hubFlipH?: boolean;
  xOffset?: number;
  tintDark?: boolean;
  noTint?: boolean;
  naturalSize?: boolean;
  srcName?: string;
  cssFilter?: string;
}

export interface HairDef {
  roomKey: string; roomX: number; roomY: number;
  hubKey:  string; hubOffX: number; hubOffY: number;
  hatRoomKey?: string; hatRoomX?: number; hatRoomY?: number;
  hatHubKey?: string; hatHubOffX?: number; hatHubOffY?: number;
  flipH?: boolean;
}
