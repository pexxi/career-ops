package data

import (
	"os"
	"path/filepath"
	"testing"
)

const notesPoisonedTracker = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|------|-------|--------|-----|--------|-------|-----|
| 149 | 2026-08-07 | OpenAI | Forward Deployed Engineer (FDE), Healthcare - SF | 4.0/5 | Evaluated | ✅ | — | row #4 (Stockholm FDE, applied) already used 1 slot | https://jobs.ashbyhq.com/openai/d8b894e3?utm_source=li |
`

func writeScanHistory(t *testing.T, root, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, "data", "scan-history.tsv"), []byte(body), 0o644); err != nil {
		t.Fatalf("write scan-history: %v", err)
	}
}

func TestScanHistoryLocationBeatsNotesRegex(t *testing.T) {
	root, _ := writeTracker(t, notesPoisonedTracker)
	writeScanHistory(t, root, "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n"+
		"https://jobs.ashbyhq.com/openai/d8b894e3\t2026-08-07\tashby-api\tFDE Healthcare\tOpenAI\tadded\tSan Francisco\n")

	apps, err := ParseApplications(root)
	if err != nil || len(apps) != 1 {
		t.Fatalf("ParseApplications: %v, %d apps", err, len(apps))
	}
	if apps[0].Location != CanonicalizeLocation("San Francisco") {
		t.Errorf("Location = %q, want the ATS location, not Stockholm from the notes", apps[0].Location)
	}
}

func TestTrackerLocationColumnBeatsScanHistory(t *testing.T) {
	root, _ := writeTracker(t, `# Applications Tracker

| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|------|----------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-06-01 | Acme | Engineer | Paris | 4.5/5 | Applied | ✅ | — | Berlin hybrid | https://jobs.example.com/1 |
`)
	writeScanHistory(t, root, "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n"+
		"https://jobs.example.com/1\t2026-06-01\tx\tEngineer\tAcme\tadded\tLondon\n")

	apps, err := ParseApplications(root)
	if err != nil || len(apps) != 1 {
		t.Fatalf("ParseApplications: %v, %d apps", err, len(apps))
	}
	if apps[0].Location != CanonicalizeLocation("Paris") {
		t.Errorf("Location = %q, want the tracker column value", apps[0].Location)
	}
}

func TestPostingURLKeyDropsTrackingAndTrailingSlash(t *testing.T) {
	a := postingURLKey("http://Jobs.Example.com/a/?utm_source=x&gh_src=y#frag")
	b := postingURLKey("https://jobs.example.com/a")
	if a == "" || a != b {
		t.Errorf("postingURLKey mismatch: %q vs %q", a, b)
	}
	if postingURLKey("local:jds/x.md") != "" {
		t.Error("non-http URL should not produce a key")
	}
}

func TestWorkModeWithRegionIsNotACityState(t *testing.T) {
	for _, raw := range []string{"Remote, DE", "Hybrid, NY", "Onsite, CA"} {
		if got := CanonicalizeLocation(raw); got != "" {
			t.Errorf("CanonicalizeLocation(%q) = %q, want empty (work mode + region)", raw, got)
		}
	}
}
