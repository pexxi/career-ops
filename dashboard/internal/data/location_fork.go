package data

// Local fork addition: an ATS location from scan-history.tsv beats a location
// lifted from the notes by regex. Upstream already prefers the tracker's
// Location column; this adds the middle tier, matched by posting URL:
//
//   tracker Location column > scan-history ATS location (by JobURL) > notes regex
//
// Notes often mention other cities ("row #4 (Stockholm FDE) already used a
// slot"), so the regex can pick the wrong place while the ATS knows the real one.

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

// preferScanHistoryLocations overwrites notes-derived locations with the ATS
// location of the same posting. fromColumn[i] is true when apps[i].Location
// came from the tracker column; those are never touched.
func preferScanHistoryLocations(careerOpsPath string, apps []model.CareerApplication, fromColumn []bool) {
	byURL := scanHistoryLocationsByURL(careerOpsPath)
	if len(byURL) == 0 {
		return
	}
	for i := range apps {
		if i < len(fromColumn) && fromColumn[i] {
			continue
		}
		if loc, ok := byURL[postingURLKey(apps[i].JobURL)]; ok {
			apps[i].Location = CanonicalizeLocation(loc)
		}
	}
}

// scanHistoryLocationsByURL maps normalized posting URL -> first non-empty
// location, reading columns by header name.
func scanHistoryLocationsByURL(careerOpsPath string) map[string]string {
	var content []byte
	for _, p := range []string{
		filepath.Join(careerOpsPath, "data", "scan-history.tsv"),
		filepath.Join(careerOpsPath, "scan-history.tsv"),
	} {
		if b, err := os.ReadFile(p); err == nil {
			content = b
			break
		}
	}
	if content == nil {
		return nil
	}
	lines := strings.Split(string(content), "\n")
	urlCol, locCol := -1, -1
	for i, name := range strings.Split(strings.TrimRight(lines[0], "\r"), "\t") {
		switch strings.TrimSpace(name) {
		case "url":
			urlCol = i
		case "location":
			locCol = i
		}
	}
	if urlCol < 0 || locCol < 0 {
		return nil
	}
	out := make(map[string]string)
	for _, line := range lines[1:] {
		fields := strings.Split(strings.TrimRight(line, "\r"), "\t")
		if len(fields) <= locCol || len(fields) <= urlCol {
			continue
		}
		key := postingURLKey(fields[urlCol])
		loc := strings.TrimSpace(fields[locCol])
		if key == "" || loc == "" || loc == "—" || loc == "-" || loc == "N/A" {
			continue
		}
		if _, seen := out[key]; !seen {
			out[key] = loc
		}
	}
	return out
}

var trackingQueryParams = map[string]bool{
	"gh_src": true, "fbclid": true, "gclid": true, "mc_cid": true, "mc_eid": true,
	"igshid": true, "_hsenc": true, "_hsmi": true, "trk": true, "trackingid": true,
}

// postingURLKey normalizes a posting URL the way merge-tracker.mjs dedups:
// https, lowercase host, no fragment, no tracking params, no trailing slash.
func postingURLKey(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ""
	}
	u.Scheme = "https"
	u.Host = strings.ToLower(u.Host)
	u.Fragment = ""
	q := u.Query()
	for k := range q {
		lk := strings.ToLower(k)
		if strings.HasPrefix(lk, "utm_") || trackingQueryParams[lk] {
			q.Del(k)
		}
	}
	u.RawQuery = q.Encode()
	if len(u.Path) > 1 {
		u.Path = strings.TrimSuffix(u.Path, "/")
	}
	return u.String()
}
