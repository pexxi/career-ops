package screens

// Local fork addition: multi-select + bulk status change on the pipeline.
// Space toggles the row under the cursor, A toggles every visible row, Esc
// clears the selection, and c with a selection opens the status picker in
// bulk mode (no Hired). Discarded/SKIP still go through the reason picker; the
// chosen reason is appended to every row. The write is one set-status-bulk.mjs
// call (see data.UpdateApplicationStatusBulk).

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/model"
)

// PipelineBulkStatusMsg asks main to set one status on several tracker rows.
type PipelineBulkStatusMsg struct {
	CareerOpsPath string
	Rows          []int
	NewStatus     string
	Note          string
}

// PipelineBulkStatusDoneMsg reports a bulk write back to the pipeline.
type PipelineBulkStatusDoneMsg struct {
	Summary string
	Err     error
	Applied bool
}

const noTrackerNumberFlash = "no tracker # on this row"

// toggleSelected flips the cursor row in the selection.
func (m PipelineModel) toggleSelected() PipelineModel {
	app, ok := m.CurrentApp()
	if !ok {
		return m
	}
	if app.Number <= 0 || app.TrackerNumberMissing {
		m.flash = noTrackerNumberFlash
		return m
	}
	m.selected = cloneSelection(m.selected)
	if m.selected[app.Number] {
		delete(m.selected, app.Number)
	} else {
		m.selected[app.Number] = true
	}
	return m
}

// toggleAllVisible selects every visible row, or clears them when all are selected.
func (m PipelineModel) toggleAllVisible() PipelineModel {
	m.selected = cloneSelection(m.selected)
	allOn := true
	var ids []int
	for _, app := range m.filtered {
		if app.Number <= 0 || app.TrackerNumberMissing {
			continue
		}
		ids = append(ids, app.Number)
		if !m.selected[app.Number] {
			allOn = false
		}
	}
	for _, n := range ids {
		if allOn {
			delete(m.selected, n)
		} else {
			m.selected[n] = true
		}
	}
	return m
}

// selectedVisibleRows returns selected tracker #s that are still visible, in
// list order, so a filter change never silently writes to hidden rows.
func (m PipelineModel) selectedVisibleRows() []int {
	var rows []int
	for _, app := range m.filtered {
		if app.Number > 0 && m.selected[app.Number] {
			rows = append(rows, app.Number)
		}
	}
	return rows
}

// openBulkStatusPicker opens the status picker for the selected rows.
func (m PipelineModel) openBulkStatusPicker() (PipelineModel, tea.Cmd) {
	rows := m.selectedVisibleRows()
	if len(rows) == 0 {
		m.flash = "selected rows are hidden by the current filter"
		return m, nil
	}
	m.bulkRows = rows
	m.statusPicker = true
	m.statusCursor = 0
	return m, nil
}

// bulkStatusPairs is the picker list in bulk mode: every status except Hired.
func bulkStatusPairs() []StatusPair {
	var out []StatusPair
	for _, pair := range getStatusPairs("") {
		if data.NormalizeStatus(pair.Canonical) != "hired" {
			out = append(out, pair)
		}
	}
	return out
}

// commitBulkStatus routes a picked status for bulk mode: Discarded/SKIP ask
// for a reason first, everything else is written straight away.
func (m PipelineModel) commitBulkStatus(newStatus string) (PipelineModel, tea.Cmd) {
	norm := data.NormalizeStatus(newStatus)
	if norm == "discarded" || norm == "skip" {
		// No single report to predict reasons from: canonical reasons only.
		return m, func() tea.Msg {
			return pipelineStartDiscardPickerMsg{app: model.CareerApplication{}, newStatus: newStatus}
		}
	}
	return m.emitBulkStatus(newStatus, "")
}

// emitBulkStatus sends the write request and leaves bulk mode.
func (m PipelineModel) emitBulkStatus(newStatus, note string) (PipelineModel, tea.Cmd) {
	rows := m.bulkRows
	m.bulkRows = nil
	path := m.careerOpsPath
	return m, func() tea.Msg {
		return PipelineBulkStatusMsg{CareerOpsPath: path, Rows: rows, NewStatus: newStatus, Note: note}
	}
}

// acceptBulkStatusDone shows the outcome; a successful write clears the selection.
func (m PipelineModel) acceptBulkStatusDone(msg PipelineBulkStatusDoneMsg) PipelineModel {
	if msg.Err != nil {
		m.flash = "Could not update status: " + msg.Err.Error()
		return m
	}
	m.flash = msg.Summary
	if msg.Applied {
		m.selected = nil
	}
	return m
}

// selectionHelp is the help-bar text while rows are selected.
func (m PipelineModel) selectionHelp() string {
	return fmt.Sprintf("%d selected   c: set status   SPACE: toggle   A: all visible   Esc: clear", len(m.selected))
}

func cloneSelection(in map[int]bool) map[int]bool {
	out := make(map[int]bool, len(in))
	for k, v := range in {
		if v {
			out[k] = true
		}
	}
	return out
}
