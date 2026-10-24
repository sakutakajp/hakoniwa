import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withNoindexMeta } from '../shared/indexing.ts';
/** 静的配信でWorkerを通らないHTMLにも適用。生成されたトップindex.htmlは除外。 */
export async function tagStaticHtml(directory: string, relative = ''): Promise<void> {
  let entries;
  try { entries = await readdir(join(directory, relative), { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) await tagStaticHtml(directory, path);
    else if (entry.isFile() && path !== 'index.html' && path.endsWith('.html')) {
      const file=join(directory,path), html=await readFile(file,'utf8');
      await writeFile(file,withNoindexMeta(html));
    }
  }
}
