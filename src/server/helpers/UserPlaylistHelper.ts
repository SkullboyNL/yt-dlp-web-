import { randomUUID } from 'crypto';
import { USER_PLAYLISTS_FILE } from '@/server/constants';
import { CacheHelper } from '@/server/helpers/CacheHelper';
import type { UserPlaylist, UserPlaylists } from '@/types/userPlaylist';

const emptyUserPlaylists = (): UserPlaylists => ({
  orders: [],
  items: {}
});

export class UserPlaylistHelper {
  static async getAll() {
    const playlists = await CacheHelper.get<UserPlaylists>(USER_PLAYLISTS_FILE);
    if (!playlists || !Array.isArray(playlists.orders) || !playlists.items) {
      return emptyUserPlaylists();
    }
    return playlists;
  }

  static async create(name: string, uuid?: string) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw 'Playlist name is required';
    }

    const playlists = await UserPlaylistHelper.getAll();
    const now = Date.now();
    const playlist: UserPlaylist = {
      id: randomUUID(),
      name: trimmedName,
      uuids: uuid ? [uuid] : [],
      createdAt: now,
      updatedAt: now
    };

    playlists.orders.push(playlist.id);
    playlists.items[playlist.id] = playlist;
    await CacheHelper.set(USER_PLAYLISTS_FILE, playlists);

    return playlists;
  }

  static async setItemPlaylists(uuid: string, playlistIds: string[]) {
    if (!uuid) {
      throw 'uuid is required';
    }

    const playlists = await UserPlaylistHelper.getAll();
    const selectedIds = new Set(playlistIds);
    const now = Date.now();

    for (const playlistId of playlists.orders) {
      const playlist = playlists.items[playlistId];
      if (!playlist) continue;

      const hasUuid = playlist.uuids.includes(uuid);
      const shouldHaveUuid = selectedIds.has(playlistId);

      if (shouldHaveUuid && !hasUuid) {
        playlist.uuids.push(uuid);
        playlist.updatedAt = now;
      } else if (!shouldHaveUuid && hasUuid) {
        playlist.uuids = playlist.uuids.filter((itemUuid) => itemUuid !== uuid);
        playlist.updatedAt = now;
      }
    }

    await CacheHelper.set(USER_PLAYLISTS_FILE, playlists);

    return playlists;
  }

  static async removeUuid(uuid: string) {
    const playlists = await UserPlaylistHelper.getAll();
    let changed = false;
    const now = Date.now();

    for (const playlist of Object.values(playlists.items)) {
      if (!playlist.uuids.includes(uuid)) continue;
      playlist.uuids = playlist.uuids.filter((itemUuid) => itemUuid !== uuid);
      playlist.updatedAt = now;
      changed = true;
    }

    if (changed) {
      await CacheHelper.set(USER_PLAYLISTS_FILE, playlists);
    }

    return playlists;
  }
}
