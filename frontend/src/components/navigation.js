// Where "Back" goes (docs/decisions.md #28). S3, S4 and S5/S6 can be opened from the Latest
// Results page (S2) or from a Property Details page (S2a); "Back" returns to whichever page the
// user came from. The origin travels in the router's location state, so it survives a refresh.

/** State to pass when navigating from the current page to S3 / S4 / S5. */
export function originState(location, extra = {}) {
  return { from: location.pathname, ...extra };
}

/** Destination and label for the page's back link. */
export function backTarget(location, criteria = {}) {
  const from = location.state?.from;
  if (from && /^\/results\/\d+$/.test(from)) return { to: from, label: "Back to property details" };
  if (from === "/results" || criteria.town) return { to: "/results", label: "Back to results" };
  return { to: "/", label: "Back to search" };
}
