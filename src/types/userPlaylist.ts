export type UserPlaylist = {
  id: string;
  name: string;
  uuids: string[];
  createdAt: number;
  updatedAt: number;
};

export type UserPlaylists = {
  orders: string[];
  items: Record<string, UserPlaylist>;
};
