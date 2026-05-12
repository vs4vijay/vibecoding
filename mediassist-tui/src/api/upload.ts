import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { MediAssistClient } from "./client.ts";

/**
 * Uploads a single document to the claim attachments staging area on the
 * portal. Uploaded files are session-scoped — they attach to the active
 * draft claim. The chain order is therefore:
 *
 *   1. SaveDraft  → mints ClaimRegNo
 *   2. uploadDocument(file)  ×N
 *   3. AddClaimBill          ×N
 *   4. SubmitClaim
 *
 * The portal serves an ASP.NET WebForms upload page at /fileuploaddomi2.aspx;
 * we GET it once to scrape `__VIEWSTATE` + `__VIEWSTATEGENERATOR`, then POST
 * the multipart form with the file under the `fileUpload` field.
 */
export async function uploadDocument(client: MediAssistClient, filePath: string): Promise<void> {
  const formPage = await client.getText("/fileuploaddomi2.aspx");
  const viewstate = pickHiddenValue(formPage, "__VIEWSTATE");
  const viewstateGen = pickHiddenValue(formPage, "__VIEWSTATEGENERATOR");
  if (!viewstate || !viewstateGen) {
    throw new Error("Could not parse the upload form (session may have expired)");
  }

  const buf = await readFile(filePath);
  const filename = basename(filePath);

  const formData = new FormData();
  formData.set("__VIEWSTATE", viewstate);
  formData.set("__VIEWSTATEGENERATOR", viewstateGen);
  formData.set(
    "fileUpload",
    new File([buf as BlobPart], filename, { type: detectMime(filename) }),
  );

  const res = await client.request("/fileuploaddomi2.aspx", {
    method: "POST",
    body: formData,
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: "https://portal.mediassist.in/fileuploaddomi2.aspx",
    },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Upload failed: HTTP ${res.status}`);
  }
  // Success-page contains the text "Upload successful!" inline.
  if (!/Upload\s+successful/i.test(body)) {
    throw new Error(
      "Upload did not return a success marker — file may not have been accepted",
    );
  }
}

function pickHiddenValue(html: string, name: string): string | undefined {
  const re = new RegExp(
    `<input[^>]+name="${name}"[^>]+value="([^"]*)"`,
    "i",
  );
  return re.exec(html)?.[1];
}

function detectMime(filename: string): string {
  switch (extname(filename).toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".bmp":
      return "image/bmp";
    case ".webp":
      return "image/webp";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}
