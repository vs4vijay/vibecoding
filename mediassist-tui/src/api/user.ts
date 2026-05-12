import type { MediAssistClient } from "./client.ts";

export type Entity = {
  entityId: number;
  entityName: string;
  entityCode: string;
};

/**
 * Returns the list of entities (employers/sub-orgs) the user belongs to.
 * Used as the `entityids` filter when listing claims.
 */
export async function getEntities(client: MediAssistClient): Promise<Entity[]> {
  const res = await client.request("/Claims.aspx?LoadEntity=true", {
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as Entity[];
  } catch {
    return [];
  }
}
