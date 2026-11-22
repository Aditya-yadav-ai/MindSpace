/**
 * Stage 8 — Google Contacts (People API v1) service adapter.
 * Uses the official Google People API.
 * Supports listing connections, searching contacts by name/email,
 * retrieving contact details, creating, updating, and deleting contacts.
 */
import { googleApiFetch } from "./api-fetch.server";
import type { ContactCreateInput, ContactSummary, ContactUpdateInput } from "./types";

const BASE = "https://people.googleapis.com/v1";
const PERSON_FIELDS = "names,emailAddresses,phoneNumbers,photos";

type PersonRaw = {
  resourceName: string;
  etag?: string;
  names?: { displayName?: string; givenName?: string; familyName?: string }[];
  emailAddresses?: { value?: string }[];
  phoneNumbers?: { value?: string }[];
  photos?: { url?: string }[];
};

function formatContact(person: PersonRaw): ContactSummary {
  const name = person.names?.[0]?.displayName || "Unnamed Contact";
  const email = person.emailAddresses?.[0]?.value ?? null;
  const phone = person.phoneNumbers?.[0]?.value ?? null;
  const photoUrl = person.photos?.[0]?.url ?? null;

  return {
    resourceName: person.resourceName,
    displayName: name,
    email,
    phone,
    photoUrl,
  };
}

/**
 * Lists the authenticated user's contacts.
 */
export async function listContacts(
  accessToken: string,
  limit: number = 20,
): Promise<ContactSummary[]> {
  const result = await googleApiFetch<{
    connections?: PersonRaw[];
  }>(
    accessToken,
    `${BASE}/people/me/connections?pageSize=${Math.min(limit, 100)}&personFields=${PERSON_FIELDS}`,
  );
  return (result.connections ?? []).map(formatContact);
}

/**
 * Searches contacts by query text (name, email, or prefix).
 */
export async function searchContacts(
  accessToken: string,
  query: string,
  limit: number = 10,
): Promise<ContactSummary[]> {
  const result = await googleApiFetch<{
    results?: { person: PersonRaw }[];
  }>(
    accessToken,
    `${BASE}/people:searchContacts?query=${encodeURIComponent(query)}&pageSize=${Math.min(limit, 30)}&readMask=${PERSON_FIELDS}`,
  );
  return (result.results ?? []).map((r) => formatContact(r.person));
}

/**
 * Retrieves full details for a single contact by resourceName.
 */
export async function getContact(
  accessToken: string,
  resourceName: string,
): Promise<ContactSummary> {
  const cleanName = resourceName.startsWith("people/") ? resourceName : `people/${resourceName}`;
  const person = await googleApiFetch<PersonRaw>(
    accessToken,
    `${BASE}/${encodeURIComponent(cleanName)}?personFields=${PERSON_FIELDS}`,
  );
  return formatContact(person);
}

/**
 * Creates a new contact in the user's Google Contacts.
 * Callers must gate this behind explicit user approval.
 */
export async function createContact(
  accessToken: string,
  input: ContactCreateInput,
): Promise<ContactSummary> {
  const personPayload: Record<string, unknown> = {
    names: [
      {
        givenName: input.givenName,
        familyName: input.familyName || "",
      },
    ],
  };
  if (input.email) {
    personPayload["emailAddresses"] = [{ value: input.email }];
  }
  if (input.phone) {
    personPayload["phoneNumbers"] = [{ value: input.phone }];
  }

  const created = await googleApiFetch<PersonRaw>(
    accessToken,
    `${BASE}/people:createContact?personFields=${PERSON_FIELDS}`,
    {
      method: "POST",
      body: JSON.stringify(personPayload),
    },
  );
  return formatContact(created);
}

/**
 * Updates an existing contact.
 * Callers must gate this behind explicit user approval.
 */
export async function updateContact(
  accessToken: string,
  input: ContactUpdateInput,
): Promise<ContactSummary> {
  const cleanName = input.resourceName.startsWith("people/")
    ? input.resourceName
    : `people/${input.resourceName}`;

  const updatePayload: Record<string, unknown> = {
    etag: input.etag,
  };
  const updateMaskParts: string[] = [];

  if (input.givenName || input.familyName) {
    updatePayload["names"] = [
      {
        givenName: input.givenName,
        familyName: input.familyName || "",
      },
    ];
    updateMaskParts.push("names");
  }
  if (input.email) {
    updatePayload["emailAddresses"] = [{ value: input.email }];
    updateMaskParts.push("emailAddresses");
  }
  if (input.phone) {
    updatePayload["phoneNumbers"] = [{ value: input.phone }];
    updateMaskParts.push("phoneNumbers");
  }

  const updated = await googleApiFetch<PersonRaw>(
    accessToken,
    `${BASE}/${encodeURIComponent(cleanName)}:updateContact?updatePersonFields=${updateMaskParts.join(",")}&personFields=${PERSON_FIELDS}`,
    {
      method: "PATCH",
      body: JSON.stringify(updatePayload),
    },
  );
  return formatContact(updated);
}

/**
 * Deletes a contact by resourceName.
 * Callers must gate this behind explicit user approval.
 */
export async function deleteContact(
  accessToken: string,
  resourceName: string,
): Promise<{ ok: true; resourceName: string }> {
  const cleanName = resourceName.startsWith("people/") ? resourceName : `people/${resourceName}`;
  await googleApiFetch(accessToken, `${BASE}/${encodeURIComponent(cleanName)}:deleteContact`, {
    method: "DELETE",
  });
  return { ok: true, resourceName: cleanName };
}
