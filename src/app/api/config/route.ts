import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { listInstances, upsertInstance } from "@/lib/db";

// Export/import of instance settings as a passphrase-encrypted file (scrypt + AES-256-GCM).
// The file holds API tokens and SSH credentials, so it is never written in the clear.
const FORMAT = "coolmigrate-config-v1";
const kdf = (pass: string, salt: Buffer) => crypto.scryptSync(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export async function POST(req: Request) {
  const b = await req.json();
  if (typeof b.passphrase !== "string" || b.passphrase.length < 8) return NextResponse.json({ error: "passphrase must be 8+ characters" }, { status: 400 });

  if (b.action === "export") {
    const plain = JSON.stringify(listInstances().map(({ id: _id, ...rest }) => rest)); // eslint-disable-line @typescript-eslint/no-unused-vars
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", kdf(b.passphrase, salt), iv);
    const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return NextResponse.json({ format: FORMAT, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64"), exported_at: new Date().toISOString() });
  }

  if (b.action === "import") {
    const f = b.file;
    if (!f || f.format !== FORMAT) return NextResponse.json({ error: "not a coolmigrate config file" }, { status: 400 });
    let items: Array<Record<string, string | null>>;
    try {
      const d = crypto.createDecipheriv("aes-256-gcm", kdf(b.passphrase, Buffer.from(f.salt, "base64")), Buffer.from(f.iv, "base64"));
      d.setAuthTag(Buffer.from(f.tag, "base64"));
      items = JSON.parse(Buffer.concat([d.update(Buffer.from(f.data, "base64")), d.final()]).toString("utf8"));
    } catch { return NextResponse.json({ error: "wrong passphrase or corrupted file" }, { status: 400 }); }
    const existing = listInstances();
    let added = 0, updated = 0;
    for (const it of items) {
      if (!it.name || !it.url || !it.ssh_host || !it.token) continue;
      const match = existing.find((e) => e.url === it.url);
      upsertInstance({ ...it, id: match?.id } as Parameters<typeof upsertInstance>[0]);
      match ? updated++ : added++;
    }
    return NextResponse.json({ added, updated });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
