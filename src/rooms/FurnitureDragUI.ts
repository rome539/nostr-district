import type { FurnitureId, RoomConfig } from '../stores/roomStore';
import { getDefaultPos, setFurniturePosition, POSTER_DEFAULT_POS, POSTER_SIZE, setPosterPosition } from '../stores/roomStore';
import { getFurnitureBounds } from './RoomRenderer';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/game.config';

const DRAG_DEPTH    = 1500;
const COLOR_IDLE    = 0x5dcaa5;
const COLOR_NEW     = 0xffd700; // gold highlight for the freshly added item
const COLOR_VALID   = 0x44ff99;
const COLOR_INVALID = 0xff4444;
const COLOR_SNAP    = 0xffaa00; // orange — will snap to table surface
const GHOST_ALPHA   = 0.35;
const LABEL_STYLE   = { fontSize: '7px', fontFamily: '"Courier New", monospace', color: '#e8fff8', align: 'center' as const };

// Desk is always fixed — exclude from collision targets but block placement inside it
const DESK_BLOCK = { x: 558, y: 160, w: 196, h: 140 };
// Cabin fireplace exclusion zone (mantel top to floor, full surround width)
const CABIN_FP_BLOCK = { x: 334, y: 170, w: 132, h: 130 };

const FLOOR_Y = 300; // floor divider line in canvas space

// Wall-mounted items — constrained to stay above the floor line
const WALL_ITEMS = new Set<FurnitureId>(['tv', 'whiteboard', 'walltapestry1', 'walltapestry2', 'walltapestry3', 'hangingivy', 'sworddec', 'persianrugwall1', 'nostrsign', 'neonskull', 'neoncoffee', 'coelacanthmount', 'neongfy', 'neon58k', 'ufopinup']);
// Flat floor rugs — must be fully below the floor line (no straddling the wall)
const FLOOR_RUG_ITEMS = new Set<FurnitureId>(['rug', 'persianrug', 'bearskin', 'striperug', 'tigerskin', 'bitcoincircularrug']);

// Items that provide a surface other items can be placed on
// surfaceY: offset from item pos.y to the top of the table surface
// surfaceXOff/surfaceW: the droppable region (relative to item pos.x)
interface SurfaceDef { surfaceY: number; surfaceXOff: number; surfaceW: number; }
const TABLE_SURFACE_DEFS: Partial<Record<FurnitureId | 'desk', SurfaceDef>> = {
  coffee_table: { surfaceY: 0,  surfaceXOff: 0,  surfaceW: 130 }, // tabletop at pos.y
  endtable:     { surfaceY: 0,  surfaceXOff: 0,  surfaceW: 89  }, // top of PNG
  desk:         { surfaceY: 82, surfaceXOff: 0,  surfaceW: 60  }, // left drawer section only (no screen)
};
// Everything else is a floor item — bottom must reach at least the floor line

interface Zone {
  id: FurnitureId;
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

interface PosterZone {
  slot: 0 | 1 | 2;
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

export class FurnitureDragUI {
  private zones: Zone[] = [];
  private posterZones: PosterZone[] = [];
  private ghost: Phaser.GameObjects.Rectangle | null = null;
  private ghostLabel: Phaser.GameObjects.Text | null = null;
  private localPos: Partial<Record<FurnitureId, { x: number; y: number }>> = {};
  private localPosterPos: [{ x: number; y: number } | null, { x: number; y: number } | null, { x: number; y: number } | null] = [null, null, null];
  private wallTheme = '';
  private activeFurniture: FurnitureId[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onRedraw: () => void,
  ) {}

  enter(cfg: RoomConfig, newItemId?: FurnitureId): void {
    this.wallTheme = cfg.wallTheme ?? '';
    this.activeFurniture = [...cfg.furniture];
    // Snapshot current positions
    this.localPos = { ...cfg.furniturePositions };

    // Sort large items first so smaller items are created later and sit on top
    // (higher creation index = higher hit-test priority at equal depth).
    const draggable = cfg.furniture
      .filter(id => id !== 'desk' && id !== 'bookshelf' && getFurnitureBounds(this.scene, id) !== null)
      .sort((a, b) => {
        const ba = getFurnitureBounds(this.scene, a)!;
        const bb = getFurnitureBounds(this.scene, b)!;
        return (bb.w * bb.h) - (ba.w * ba.h);
      });

    for (let i = 0; i < draggable.length; i++) {
      const id     = draggable[i];
      const def    = getDefaultPos(id);
      const bounds = getFurnitureBounds(this.scene, id)!;
      const pos    = this.localPos[id] ?? def;
      const cx     = pos.x + bounds.w / 2;
      const cy     = pos.y + bounds.h / 2;

      const isNew = id === newItemId;
      const idleColor = isNew ? COLOR_NEW : COLOR_IDLE;
      const rect = this.scene.add
        .rectangle(cx, cy, bounds.w, bounds.h, idleColor, isNew ? 0.35 : 0.25)
        .setStrokeStyle(isNew ? 2 : 1, idleColor, isNew ? 1 : 0.8)
        .setDepth(DRAG_DEPTH + i)
        .setInteractive({ draggable: true, cursor: 'grab' });

      const label = this.scene.add
        .text(cx, cy, isNew ? `★ ${id.replace(/_/g, ' ')}` : id.replace(/_/g, ' '), isNew ? { ...LABEL_STYLE, color: '#ffd700' } : LABEL_STYLE)
        .setOrigin(0.5)
        .setDepth(DRAG_DEPTH + i + 0.5);

      this.scene.input.setDraggable(rect);

      rect.on('dragstart', () => {
        const topDepth = DRAG_DEPTH + draggable.length;
        this.ghost = this.scene.add
          .rectangle(rect.x, rect.y, bounds.w, bounds.h, COLOR_VALID, GHOST_ALPHA)
          .setStrokeStyle(1, COLOR_VALID, 1)
          .setDepth(topDepth);
        this.ghostLabel = this.scene.add
          .text(rect.x, rect.y, id.replace(/_/g, ' '), { ...LABEL_STYLE, color: '#ffffff' })
          .setOrigin(0.5)
          .setDepth(topDepth + 0.5);
        rect.setAlpha(0.3);
      });

      let lastDragX = cx;
      let lastDragY = cy;

      rect.on('drag', (_ptr: Phaser.Input.Pointer, dragX: number, dragY: number) => {
        lastDragX = dragX;
        lastDragY = dragY;
        if (!this.ghost || !this.ghostLabel) return;

        const nx = dragX - bounds.w / 2;
        const ny = dragY - bounds.h / 2;
        const snap = this.trySnapToSurface(id, nx, ny, bounds);

        if (snap !== null) {
          // Show ghost at snapped position with orange snap color
          const snappedCY = snap + bounds.h / 2;
          this.ghost.x = dragX;
          this.ghost.y = snappedCY;
          this.ghostLabel.x = dragX;
          this.ghostLabel.y = snappedCY;
          this.ghost.fillColor = COLOR_SNAP;
          this.ghost.setStrokeStyle(2, COLOR_SNAP, 1);
        } else {
          this.ghost.x = dragX;
          this.ghost.y = dragY;
          this.ghostLabel.x = dragX;
          this.ghostLabel.y = dragY;
          const valid = this.isPlacementValid(id, nx, ny, bounds);
          const col = valid ? COLOR_VALID : COLOR_INVALID;
          this.ghost.fillColor = col;
          this.ghost.setStrokeStyle(1, col, 1);
        }
      });

      // Phaser 3 'dragend' on a game object passes (pointer, dropped) — no dragX/dragY.
      // Use lastDragX/Y tracked in the 'drag' handler instead.
      rect.on('dragend', () => {
        const nx = Math.round(Phaser.Math.Clamp(lastDragX - bounds.w / 2, 0, GAME_WIDTH  - bounds.w));
        let   ny = Math.round(Phaser.Math.Clamp(lastDragY - bounds.h / 2, 0, GAME_HEIGHT - bounds.h));

        const snap = this.trySnapToSurface(id, nx, ny, bounds);
        const onTable = snap !== null;
        if (onTable) ny = snap!;

        // If this item is a table, capture its old surface before moving
        const oldSurface = (id as string) in TABLE_SURFACE_DEFS ? this.getSurface(id as FurnitureId) : null;

        if (this.isPlacementValid(id, nx, ny, bounds, onTable)) {
          this.localPos[id] = { x: nx, y: ny };
          setFurniturePosition(id, { x: nx, y: ny });
          rect.x = nx + bounds.w / 2;
          rect.y = ny + bounds.h / 2;
          label.x = rect.x;
          label.y = rect.y;
          if (oldSurface) this.dropItemsFromSurface(oldSurface);
          this.onRedraw();
        } else {
          // Snap back to current committed position
          const cur = this.localPos[id] ?? getDefaultPos(id);
          rect.x = cur.x + bounds.w / 2;
          rect.y = cur.y + bounds.h / 2;
          label.x = rect.x;
          label.y = rect.y;
        }

        this.ghost?.destroy();    this.ghost = null;
        this.ghostLabel?.destroy(); this.ghostLabel = null;
        rect.setAlpha(1);
      });

      this.zones.push({ id, rect, label });
    }

    // ── Poster zones ──
    this.localPosterPos = [...cfg.posterPositions] as typeof this.localPosterPos;
    const topDepth = DRAG_DEPTH + draggable.length;

    for (let s = 0; s < 3; s++) {
      const slot = s as 0 | 1 | 2;
      if (cfg.posters[slot] === 'none') continue;
      const def    = POSTER_DEFAULT_POS[slot];
      const sz     = POSTER_SIZE[slot];
      const pos    = this.localPosterPos[slot] ?? def;
      const cx     = pos.x + sz.w / 2;
      const cy     = pos.y + sz.h / 2;

      const rect = this.scene.add
        .rectangle(cx, cy, sz.w, sz.h, COLOR_IDLE, 0.2)
        .setStrokeStyle(1, COLOR_IDLE, 0.9)
        .setDepth(topDepth + s)
        .setInteractive({ draggable: true, cursor: 'grab' });

      const label = this.scene.add
        .text(cx, cy, `art ${slot + 1}`, LABEL_STYLE)
        .setOrigin(0.5)
        .setDepth(topDepth + s + 0.5);

      this.scene.input.setDraggable(rect);

      let lastDragX = cx;
      let lastDragY = cy;

      rect.on('dragstart', () => {
        const gDepth = topDepth + 10;
        this.ghost = this.scene.add
          .rectangle(rect.x, rect.y, sz.w, sz.h, COLOR_VALID, GHOST_ALPHA)
          .setStrokeStyle(1, COLOR_VALID, 1).setDepth(gDepth);
        this.ghostLabel = this.scene.add
          .text(rect.x, rect.y, `art ${slot + 1}`, { ...LABEL_STYLE, color: '#ffffff' })
          .setOrigin(0.5).setDepth(gDepth + 0.5);
        rect.setAlpha(0.3);
      });

      rect.on('drag', (_ptr: Phaser.Input.Pointer, dragX: number, dragY: number) => {
        lastDragX = dragX; lastDragY = dragY;
        if (!this.ghost || !this.ghostLabel) return;
        this.ghost.x = dragX; this.ghost.y = dragY;
        this.ghostLabel.x = dragX; this.ghostLabel.y = dragY;
        const nx = dragX - sz.w / 2; const ny = dragY - sz.h / 2;
        const col = this.isPosterPlacementValid(nx, ny, sz) ? COLOR_VALID : COLOR_INVALID;
        this.ghost.fillColor = col; this.ghost.setStrokeStyle(1, col, 1);
      });

      rect.on('dragend', () => {
        const nx = Math.round(Phaser.Math.Clamp(lastDragX - sz.w / 2, 0, GAME_WIDTH  - sz.w));
        const ny = Math.round(Phaser.Math.Clamp(lastDragY - sz.h / 2, 0, GAME_HEIGHT - sz.h));
        if (this.isPosterPlacementValid(nx, ny, sz)) {
          this.localPosterPos[slot] = { x: nx, y: ny };
          setPosterPosition(slot, { x: nx, y: ny });
          rect.x = nx + sz.w / 2; rect.y = ny + sz.h / 2;
          label.x = rect.x; label.y = rect.y;
          this.onRedraw();
        } else {
          const cur = this.localPosterPos[slot] ?? POSTER_DEFAULT_POS[slot];
          rect.x = cur.x + sz.w / 2; rect.y = cur.y + sz.h / 2;
          label.x = rect.x; label.y = rect.y;
        }
        this.ghost?.destroy(); this.ghost = null;
        this.ghostLabel?.destroy(); this.ghostLabel = null;
        rect.setAlpha(1);
      });

      this.posterZones.push({ slot, rect, label });
    }
  }

  setPreview(on: boolean): void {
    const all = [
      ...this.zones.map(z => z.rect),
      ...this.posterZones.map(z => z.rect),
    ];
    const labels = [
      ...this.zones.map(z => z.label),
      ...this.posterZones.map(z => z.label),
    ];
    all.forEach(rect => {
      rect.setVisible(!on);
      if (on) rect.disableInteractive();
      else { rect.setInteractive({ draggable: true, cursor: 'grab' }); this.scene.input.setDraggable(rect); }
    });
    labels.forEach(l => l.setVisible(!on));
  }

  exit(): void {
    this.zones.forEach(({ rect, label }) => { rect.destroy(); label.destroy(); });
    this.zones = [];
    this.posterZones.forEach(({ rect, label }) => { rect.destroy(); label.destroy(); });
    this.posterZones = [];
    this.ghost?.destroy();      this.ghost = null;
    this.ghostLabel?.destroy(); this.ghostLabel = null;
    this.localPos = {};
    this.localPosterPos = [null, null, null];
  }

  /** Returns the live absolute position of a table surface, or null if not present. */
  private getSurface(tableId: FurnitureId | 'desk'): { x: number; surfaceY: number; w: number } | null {
    const def = TABLE_SURFACE_DEFS[tableId];
    if (!def) return null;
    if (tableId !== 'desk' && !this.activeFurniture.includes(tableId as FurnitureId)) return null;
    const pos = tableId === 'desk'
      ? { x: 558, y: 160 }  // desk is always fixed
      : (this.localPos[tableId as FurnitureId] ?? getDefaultPos(tableId as FurnitureId));
    return {
      x: pos.x + def.surfaceXOff,
      surfaceY: pos.y + def.surfaceY,
      w: def.surfaceW,
    };
  }

  /**
   * If the item's center x falls within a table's surface zone and the item fits
   * (narrower than the surface, not a wall/rug item), returns the snapped ny
   * so the item's bottom sits exactly on the surface. Returns null otherwise.
   */
  /** When a table moves, drop any items that were sitting on its old surface to the floor. */
  private dropItemsFromSurface(surface: { x: number; surfaceY: number; w: number }): void {
    for (const zone of this.zones) {
      const pos = this.localPos[zone.id];
      if (!pos) continue;
      const b = getFurnitureBounds(this.scene, zone.id);
      if (!b) continue;
      const bottom = pos.y + b.h;
      const cx = pos.x + b.w / 2;
      if (Math.abs(bottom - surface.surfaceY) <= 2 && cx >= surface.x && cx <= surface.x + surface.w) {
        const floorY = FLOOR_Y - b.h;
        this.localPos[zone.id] = { x: pos.x, y: floorY };
        setFurniturePosition(zone.id, { x: pos.x, y: floorY });
        zone.rect.y = floorY + b.h / 2;
        zone.label.y = zone.rect.y;
      }
    }
  }

  private trySnapToSurface(id: FurnitureId, nx: number, ny: number, bounds: { w: number; h: number }): number | null {
    if (WALL_ITEMS.has(id) || FLOOR_RUG_ITEMS.has(id)) return null;
    const cx = nx + bounds.w / 2;
    const itemBottom = ny + bounds.h;
    for (const tableId of Object.keys(TABLE_SURFACE_DEFS) as (FurnitureId | 'desk')[]) {
      if (tableId === id) continue;
      const surface = this.getSurface(tableId);
      if (!surface) continue;
      if (bounds.w > surface.w) continue;
      // Must be horizontally over the surface
      if (cx < surface.x || cx > surface.x + surface.w) continue;
      // Must be vertically near the surface — item bottom within 40px of surface y
      if (Math.abs(itemBottom - surface.surfaceY) > 40) continue;
      const snappedNy = surface.surfaceY - bounds.h;
      return Math.round(Phaser.Math.Clamp(snappedNy, 0, GAME_HEIGHT - bounds.h));
    }
    return null;
  }

  private isPlacementValid(
    id: FurnitureId,
    nx: number,
    ny: number,
    bounds: { w: number; h: number },
    onTable = false,
  ): boolean {
    // Room bounds check
    if (nx < 0 || ny < 0 || nx + bounds.w > GAME_WIDTH || ny + bounds.h > GAME_HEIGHT) return false;

    // Items placed on a table surface bypass desk/fireplace blocks and floor constraints
    if (onTable) return true;

    // Desk exclusion zone — desk is fixed, nothing can be placed inside it
    if (this.overlaps({ x: nx, y: ny, ...bounds }, DESK_BLOCK)) return false;

    // Cabin fireplace — wall items cannot overlap the stone surround
    if (this.wallTheme === 'cabin' && WALL_ITEMS.has(id)) {
      if (this.overlaps({ x: nx, y: ny, ...bounds }, CABIN_FP_BLOCK)) return false;
    }

    // Floor/wall zone constraints
    if (WALL_ITEMS.has(id)) {
      // Wall items must stay fully above the floor line
      if (ny + bounds.h > FLOOR_Y) return false;
    } else if (FLOOR_RUG_ITEMS.has(id)) {
      // Flat rugs must be fully on the floor — top cannot go above the floor line
      if (ny < FLOOR_Y) return false;
    } else {
      // Floor items: bottom must reach at least the floor line
      if (ny + bounds.h < FLOOR_Y) return false;
    }

    return true;
  }

  private isPosterPlacementValid(nx: number, ny: number, sz: { w: number; h: number }): boolean {
    if (nx < 0 || ny < 0 || nx + sz.w > GAME_WIDTH || ny + sz.h > GAME_HEIGHT) return false;
    // Posters are wall items — must stay above the floor line
    if (ny + sz.h > FLOOR_Y) return false;
    if (this.wallTheme === 'cabin' && this.overlaps({ x: nx, y: ny, ...sz }, CABIN_FP_BLOCK)) return false;
    return true;
  }

  private overlaps(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
}
