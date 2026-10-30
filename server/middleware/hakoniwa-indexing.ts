import { ROBOTS_NOINDEX, shouldNoindex } from '../../shared/indexing';
export default defineEventHandler(event => {
  if (shouldNoindex(getRequestURL(event).pathname)) setResponseHeader(event, 'X-Robots-Tag', ROBOTS_NOINDEX);
});
