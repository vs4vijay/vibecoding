import { Request } from './request';

export interface Collection {
  id: string;
  name: string;
  description?: string;
  folders: Folder[];
  requests: Request[];
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
  collectionId: string;
  parentFolderId?: string;
  folders: Folder[];
  requests: Request[];
  createdAt: number;
}
