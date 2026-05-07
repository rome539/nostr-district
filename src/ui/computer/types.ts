import type { AvatarConfig } from '../../stores/avatarStore';
import type { RoomConfig } from '../../stores/roomStore';
import type { PetSelection } from '../../stores/petStore';
import type { MyRoomTrackId } from '../../audio/SoundEngine';

export type OnAvatarChange = (avatar: AvatarConfig) => void;
export type OnRoomChange   = (config: RoomConfig) => void;
export type OnPetChange    = (sel: PetSelection) => void;
export type OnStatusUpdate = (status: string) => void;
export type OnMusicChange  = (trackId: MyRoomTrackId) => void;

export interface TabCtx {
  panel: HTMLDivElement;
  rerender: () => void;
  hideForPreview: () => void;
  showAfterPreview: () => void;
  onAvatarChange:  OnAvatarChange | null;
  onProfileSave:   ((name: string) => void) | null;
  onRoomChange:    OnRoomChange | null;
  onPetChange:     OnPetChange | null;
  onStatusUpdate:  OnStatusUpdate | null;
  onMusicChange:   OnMusicChange | null;
  onEnterArrange:  ((newItemId?: string) => void) | null;
}
