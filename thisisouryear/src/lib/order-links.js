// Shared ordering links preselect the garment, while each buyer chooses a size.
export function orderPath({ slug, style = 'tee', audience = 'adult', designId = 'this-is-our-year' }) {
  const query = new URLSearchParams({ city: slug });
  if (style !== 'tee') query.set('style', style);
  if (audience !== 'adult') query.set('fit', audience);
  if (designId !== 'this-is-our-year') query.set('design', designId);
  return `/order/?${query}`;
}
