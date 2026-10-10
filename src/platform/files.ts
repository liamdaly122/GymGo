import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNativeApp } from './native';

/**
 * Hands a generated file to the user: an export of everything, as JSON or CSV.
 *
 * In a browser it is a download through an anchor, from a blob URL rather
 * than a data URL because iOS Safari truncates large data URLs and a full
 * history is not small. Inside the app an anchor download does nothing at
 * all, so the file is written to the app's own cache and offered through the
 * share sheet: Save to Files, AirDrop, Mail. Closing the sheet without
 * choosing is "cancelled", which is not an error and gets no message.
 */
export async function saveFile(contents: string, filename: string, mime: string): Promise<'saved' | 'cancelled'> {
  if (!isNativeApp()) {
    downloadInBrowser(contents, filename, mime);
    return 'saved';
  }
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: contents,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  try {
    await Share.share({ title: filename, url: uri });
    return 'saved';
  } catch {
    return 'cancelled';
  }
}

function downloadInBrowser(contents: string, filename: string, mime: string): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick so Safari has actually started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
