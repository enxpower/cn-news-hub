// Shared helpers for fetching and paginating the articles content collection.
import { getCollection, type CollectionEntry } from 'astro:content';
import siteConfig from '../../site.config.json';

export type Article = CollectionEntry<'articles'>;

// All articles, newest first.
export async function getAllArticlesSorted(): Promise<Article[]> {
  const entries = await getCollection('articles');
  return entries.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export async function getArticlesByCategory(categoryId: string): Promise<Article[]> {
  const all = await getAllArticlesSorted();
  return all.filter((entry) => entry.data.category === categoryId);
}

export function getPageSize(): number {
  return siteConfig.pagination.pageSize;
}

export function totalPagesFor(itemCount: number): number {
  return Math.max(1, Math.ceil(itemCount / getPageSize()));
}

// Returns the slice of articles for a given 1-indexed page number.
export function paginate<T>(items: T[], page: number): T[] {
  const pageSize = getPageSize();
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
