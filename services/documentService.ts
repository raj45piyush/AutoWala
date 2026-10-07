import { supabase } from '../lib/supabase';

export type RiderDocumentType = 'id-proof' | 'vehicle-photo';

export interface RiderDocument {
  name: string;
  path: string;
  created_at: string | null;
}

function getSafeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
}

async function requireUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Please log in to manage documents.');
  }

  return user.id;
}

export async function uploadRiderDocument(
  type: RiderDocumentType,
  file: { uri: string; name: string; mimeType?: string | null }
) {
  const userId = await requireUserId();
  const response = await fetch(file.uri);
  if (!response.ok) {
    throw new Error('The selected document could not be read.');
  }

  const blob = await response.blob();
  const path = `${userId}/${type}/${Date.now()}-${getSafeFileName(file.name)}`;
  const { error } = await supabase.storage.from('rider-documents').upload(path, blob, {
    contentType: file.mimeType ?? 'application/octet-stream',
    upsert: false,
  });

  if (error) {
    throw new Error(error.message);
  }

  return path;
}

export async function createPrivateDocumentUrl(path: string, expiresInSeconds = 60) {
  const { data, error } = await supabase.storage
    .from('rider-documents')
    .createSignedUrl(path, expiresInSeconds);

  if (error) {
    throw new Error(error.message);
  }

  return data.signedUrl;
}

export async function listOwnRiderDocuments() {
  const userId = await requireUserId();
  return listRiderDocuments(userId);
}

async function listDocumentFolder(folderPath: string): Promise<RiderDocument[]> {
  const { data, error } = await supabase.storage
    .from('rider-documents')
    .list(folderPath, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });

  if (error) {
    throw new Error(error.message);
  }

  const documents = await Promise.all(
    (data ?? []).map(async (entry) => {
      const path = `${folderPath}/${entry.name}`;

      if (entry.id) {
        return [{
          name: entry.name,
          path,
          created_at: entry.created_at ?? null,
        }];
      }

      return listDocumentFolder(path);
    })
  );

  return documents.flat();
}

export async function listRiderDocuments(userId: string) {
  return listDocumentFolder(userId);
}
