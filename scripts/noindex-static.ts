import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shouldNoindex, withNoindexMeta } from '../shared/indexing';
/** このLayer配下の静的HTMLだけに適用。ホストのHTMLは走査・変更しない。 */
export async function tagStaticHtml(directory: string, relative = 'ja/hakoniwa'): Promise<void> {
  let entries;
  try { entries = await readdir(join(directory, relative), { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) await tagStaticHtml(directory, path);
    else if (entry.isFile() && path.endsWith('.html') && shouldNoindex('/' + path)) {
      const file=join(directory,path), html=await readFile(file,'utf8');
      await writeFile(file,withNoindexMeta(html));
    }
  }
}
