package data

// Local fork addition: bulk status changes from the pipeline multi-select.
// Single rows keep using upstream's runStatusWriter (set-status.mjs); several
// rows go to the fork's set-status-bulk.mjs in one spawn, one lock and one
// atomic tracker write.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// BulkRowOutcome is one requested row in set-status-bulk.mjs --json output.
type BulkRowOutcome struct {
	Kind string `json:"kind"` // changed | unchanged | notFound | ambiguous
	N    int    `json:"n"`
}

// BulkStatusResult is the set-status-bulk.mjs --json document.
type BulkStatusResult struct {
	Applied        bool             `json:"applied"`
	Reason         string           `json:"reason"`
	Error          string           `json:"error"`
	TrackerWritten bool             `json:"trackerWritten"`
	LedgerWarning  string           `json:"ledgerWarning"`
	Outcomes       []BulkRowOutcome `json:"outcomes"`
}

// Summary is a one-line, user-facing description of the result.
func (r BulkStatusResult) Summary(status string) string {
	if !r.Applied {
		var bad []string
		for _, o := range r.Outcomes {
			if o.Kind == "notFound" || o.Kind == "ambiguous" {
				bad = append(bad, fmt.Sprintf("#%d %s", o.N, o.Kind))
			}
		}
		return "Nothing changed: " + strings.Join(bad, ", ")
	}
	changed := 0
	for _, o := range r.Outcomes {
		if o.Kind == "changed" {
			changed++
		}
	}
	msg := fmt.Sprintf("%d of %d rows set to %s", changed, len(r.Outcomes), status)
	if r.LedgerWarning != "" {
		msg += " (status-log append failed)"
	}
	return msg
}

// BulkStatusArgs builds the set-status-bulk.mjs argv (script excluded).
// Rows are de-duplicated and sorted so the command is stable.
func BulkStatusArgs(rows []int, status, note string) []string {
	seen := map[int]bool{}
	var ids []int
	for _, n := range rows {
		if n > 0 && !seen[n] {
			seen[n] = true
			ids = append(ids, n)
		}
	}
	sort.Ints(ids)
	parts := make([]string, len(ids))
	for i, n := range ids {
		parts[i] = strconv.Itoa(n)
	}
	args := []string{"--rows", strings.Join(parts, ","), status, "--json"}
	if note != "" {
		args = append(args, "--note="+note)
	}
	return args
}

// UpdateApplicationStatusBulk sets one status (and optional note) on several
// tracker rows by tracker #. Validation beyond cheap UI checks is the
// script's job; an all-or-nothing rejection comes back as Applied=false.
func UpdateApplicationStatusBulk(careerOpsPath string, rows []int, status, note string) (BulkStatusResult, error) {
	var result BulkStatusResult
	if len(rows) == 0 {
		return result, fmt.Errorf("no rows selected")
	}
	if strings.ContainsAny(note, "|\r\n\t") {
		return result, fmt.Errorf("notes cannot contain table delimiters or line breaks")
	}
	if !isCanonicalStatusName(status) {
		return result, fmt.Errorf("unrecognized status: %q", status)
	}
	script, err := CheckoutScriptPath("set-status-bulk.mjs")
	if err != nil {
		return result, fmt.Errorf("bulk status updates need set-status-bulk.mjs in the career-ops checkout: %w", err)
	}
	tracker, err := canonicalPath(resolveTrackerPath(careerOpsPath))
	if err != nil {
		return result, fmt.Errorf("resolve tracker path: %w", err)
	}
	root, err := filepath.Abs(careerOpsPath)
	if err != nil {
		return result, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", append([]string{script}, BulkStatusArgs(rows, status, note)...)...)
	cmd.Dir = filepath.Dir(script)
	// Same environment contract as runStatusWriter: pin the exact tracker and
	// keep lock waits short enough for an interactive UI.
	wait := envMilliseconds("CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS", 10*time.Second)
	if wait > 10*time.Second {
		wait = 10 * time.Second
	}
	cmd.Env = append(cmd.Environ(), "CAREER_OPS_ROOT="+root, "CAREER_OPS_TRACKER="+tracker,
		"CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS="+strconv.FormatInt(wait.Milliseconds(), 10))
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, runErr := cmd.Output()
	if ctx.Err() != nil {
		return result, fmt.Errorf("bulk status update timed out; reload to check what was applied")
	}
	parseErr := json.Unmarshal(stdout, &result)
	if result.Error != "" {
		return result, fmt.Errorf("bulk status update: %s", result.Error)
	}
	if parseErr != nil || result.Outcomes == nil {
		if runErr != nil {
			return result, fmt.Errorf("run set-status-bulk.mjs: %w: %s", runErr, strings.TrimSpace(stderr.String()))
		}
		return result, fmt.Errorf("set-status-bulk.mjs returned no valid result; reload to check what was applied")
	}
	// Exit 2/3/5 with a parsed document is a clean all-or-nothing rejection,
	// reported through result.Applied rather than as an error.
	return result, nil
}
