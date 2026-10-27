import { NextResponse } from 'next/server';
import UploadManager from '@/lib/uploads/manager';
import { isKmEnabled } from '@/lib/km/config';
import { getKmFileData } from '@/lib/km/store';

// KM preparation state of an uploaded file: how many groups it was split into
// and whether their KV cache has been warmed yet.
export async function GET(req: Request) {
  const fileId = new URL(req.url).searchParams.get('fileId');

  if (!fileId) {
    return NextResponse.json({ message: 'Missing fileId' }, { status: 400 });
  }

  if (!UploadManager.getFile(fileId)) {
    return NextResponse.json({ message: 'File not found' }, { status: 404 });
  }

  const km = getKmFileData(fileId);

  return NextResponse.json({
    fileId,
    kmEnabled: isKmEnabled(),
    km: km
      ? {
          groups: km.groups.map((g) => ({ id: g.id, tokens: g.tokens })),
          warm: km.warm,
        }
      : null,
  });
}
