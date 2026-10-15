package data

import (
	"os"
	"os/exec"
	"reflect"
	"strings"
	"testing"
)

func TestBulkStatusArgsSortsDedupesAndAddsNote(t *testing.T) {
	got := BulkStatusArgs([]int{9, 3, 9, 0, 5}, "Discarded", "DISCARD: comp")
	want := []string{"--rows", "3,5,9", "Discarded", "--json", "--note=DISCARD: comp"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("BulkStatusArgs = %v, want %v", got, want)
	}
}

func TestBulkStatusResultSummary(t *testing.T) {
	ok := BulkStatusResult{Applied: true, Outcomes: []BulkRowOutcome{{Kind: "changed", N: 1}, {Kind: "unchanged", N: 2}}}
	if got := ok.Summary("Applied"); got != "1 of 2 rows set to Applied" {
		t.Errorf("summary = %q", got)
	}
	rejected := BulkStatusResult{Applied: false, Outcomes: []BulkRowOutcome{{Kind: "changed", N: 1}, {Kind: "notFound", N: 9}}}
	if got := rejected.Summary("Applied"); got != "Nothing changed: #9 notFound" {
		t.Errorf("summary = %q", got)
	}
}

const bulkTracker = "# Applications Tracker\n\n" + statusTargetHeader +
	"| 1 | 2026-09-01 | Acme | Engineer | 4.2/5 | Evaluated | ❌ | [1](reports/001.md) | one |\n" +
	"| 2 | 2026-09-02 | Beta | Engineer | 4.0/5 | Evaluated | ❌ | [2](reports/002.md) | two |\n"

func TestUpdateApplicationStatusBulkWritesAllRows(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}
	t.Setenv("CAREER_OPS_TRACKER", "")
	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	root, tracker := writeTracker(t, bulkTracker)

	result, err := UpdateApplicationStatusBulk(root, []int{1, 2}, "Discarded", "DISCARD: comp")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Applied || !result.TrackerWritten || len(result.Outcomes) != 2 {
		t.Fatalf("unexpected result: %+v", result)
	}
	content, _ := os.ReadFile(tracker)
	if strings.Count(string(content), "| Discarded |") != 2 || strings.Count(string(content), "DISCARD: comp") != 2 {
		t.Fatalf("tracker not updated:\n%s", content)
	}
}

func TestUpdateApplicationStatusBulkRejectsUnknownRowWithoutWriting(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}
	t.Setenv("CAREER_OPS_TRACKER", "")
	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	root, tracker := writeTracker(t, bulkTracker)

	result, err := UpdateApplicationStatusBulk(root, []int{1, 99}, "Applied", "")
	if err != nil {
		t.Fatal(err)
	}
	if result.Applied {
		t.Fatalf("expected rejection, got %+v", result)
	}
	content, _ := os.ReadFile(tracker)
	if string(content) != bulkTracker {
		t.Fatalf("tracker changed on a rejected batch:\n%s", content)
	}
}

func TestUpdateApplicationStatusBulkRejectsBadInput(t *testing.T) {
	if _, err := UpdateApplicationStatusBulk(t.TempDir(), nil, "Applied", ""); err == nil {
		t.Error("expected error for empty selection")
	}
	if _, err := UpdateApplicationStatusBulk(t.TempDir(), []int{1}, "Nope", ""); err == nil {
		t.Error("expected error for unknown status")
	}
	if _, err := UpdateApplicationStatusBulk(t.TempDir(), []int{1}, "Applied", "a|b"); err == nil {
		t.Error("expected error for a note with a pipe")
	}
}
