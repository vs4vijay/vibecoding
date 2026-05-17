export interface Venue {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface Host {
  name: string;
  memberId?: string;
}

export interface Group {
  urlname: string;
  name: string;
  city?: string;
  country?: string;
  memberCount?: number;
  topics?: string[];
  description?: string;
  upcomingEventCount?: number;
}

export interface Event {
  id: string;
  title: string;
  dateTime: string; // ISO string
  endTime?: string;
  eventUrl: string;
  description?: string;
  going?: number;
  venue?: Venue;
  group: Pick<Group, "urlname" | "name" | "city" | "country">;
  hosts?: Host[];
  imageUrl?: string;
  isOnline?: boolean;
  eventType?: string;
}
