package screens

import (
	"reflect"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func bulkTestModel() PipelineModel {
	apps := []model.CareerApplication{
		{Number: 1, Company: "Acme", Role: "Engineer", Status: "Evaluated", Score: 4.2, HasScore: true},
		{Number: 2, Company: "Beta", Role: "Engineer", Status: "Evaluated", Score: 4.0, HasScore: true},
		{Number: 3, Company: "Gamma", Role: "Engineer", Status: "Applied", Score: 3.9, HasScore: true},
	}
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "/tmp/co", 120, 40)
	pm.viewMode = "flat"
	pm.sortMode = sortCompany
	pm.applyFilterAndSort()
	return pm
}

func key(s string) tea.KeyMsg {
	switch s {
	case "esc":
		return tea.KeyMsg{Type: tea.KeyEsc}
	case "enter":
		return tea.KeyMsg{Type: tea.KeyEnter}
	case " ":
		return tea.KeyMsg{Type: tea.KeySpace, Runes: []rune{' '}}
	}
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(s)}
}

func press(pm PipelineModel, keys ...string) (PipelineModel, tea.Cmd) {
	var cmd tea.Cmd
	for _, k := range keys {
		pm, cmd = pm.Update(key(k))
	}
	return pm, cmd
}

func TestSpaceTogglesAndAToggleAllVisible(t *testing.T) {
	pm := bulkTestModel()
	pm, _ = press(pm, " ")
	if !reflect.DeepEqual(pm.selectedVisibleRows(), []int{1}) {
		t.Fatalf("after space: %v", pm.selectedVisibleRows())
	}
	pm, _ = press(pm, "A")
	if !reflect.DeepEqual(pm.selectedVisibleRows(), []int{1, 2, 3}) {
		t.Fatalf("after A: %v", pm.selectedVisibleRows())
	}
	pm, _ = press(pm, "A")
	if len(pm.selected) != 0 {
		t.Fatalf("second A should clear: %v", pm.selected)
	}
	pm, _ = press(pm, " ", "esc")
	if len(pm.selected) != 0 {
		t.Fatal("Esc should clear the selection")
	}
}

func TestBulkPickerExcludesHiredAndEmitsOneBulkMessage(t *testing.T) {
	pm := bulkTestModel()
	pm, _ = press(pm, "A", "c")
	if pm.bulkRows == nil || !pm.statusPicker {
		t.Fatal("c with a selection should open the bulk picker")
	}
	for _, pair := range pm.currentStatusPairs() {
		if pair.Canonical == "Hired" {
			t.Fatal("bulk picker must not offer Hired")
		}
	}
	// First non-discard option is Evaluated; move to Applied (index 1).
	pm.statusCursor = 1
	pm, cmd := press(pm, "enter")
	if cmd == nil {
		t.Fatal("expected a command")
	}
	msg, ok := cmd().(PipelineBulkStatusMsg)
	if !ok {
		t.Fatalf("expected PipelineBulkStatusMsg")
	}
	if !reflect.DeepEqual(msg.Rows, []int{1, 2, 3}) || msg.NewStatus != pm.currentStatusPairs()[1].Canonical || msg.Note != "" {
		t.Fatalf("unexpected bulk msg: %+v", msg)
	}
	if pm.bulkRows != nil {
		t.Fatal("bulk mode should end after emitting")
	}
}

func TestBulkDiscardAsksForReasonAndAppendsIt(t *testing.T) {
	pm := bulkTestModel()
	pm, _ = press(pm, " ", "j", " ", "c")
	idx := -1
	for i, pair := range pm.currentStatusPairs() {
		if pair.Canonical == "Discarded" {
			idx = i
		}
	}
	pm.statusCursor = idx
	pm, cmd := press(pm, "enter")
	pm, _ = pm.Update(cmd())
	if !pm.discardPicker {
		t.Fatal("Discarded should open the reason picker")
	}
	pm.discardCursor = 0
	reason := pm.discardOptions[0]
	_, cmd = press(pm, "enter")
	msg, ok := cmd().(PipelineBulkStatusMsg)
	if !ok {
		t.Fatalf("expected PipelineBulkStatusMsg")
	}
	if !reflect.DeepEqual(msg.Rows, []int{1, 2}) || msg.NewStatus != "Discarded" || msg.Note != "DISCARD: "+reason {
		t.Fatalf("unexpected bulk msg: %+v", msg)
	}
}

func TestBulkSelectionSurvivesReloadAndRendersMarker(t *testing.T) {
	pm := bulkTestModel()
	pm, _ = press(pm, " ")
	pm = pm.WithReloadedData(pm.apps, pm.metrics)
	if !pm.selected[1] {
		t.Fatal("selection lost on reload")
	}
	if !strings.Contains(pm.renderAppLine(pm.filtered[0], false), "✓1") {
		t.Fatal("selected row should render the ✓ marker")
	}
	pm = pm.acceptBulkStatusDone(PipelineBulkStatusDoneMsg{Summary: "1 of 1 rows set to Applied", Applied: true})
	if len(pm.selected) != 0 || pm.flash == "" {
		t.Fatal("a successful bulk write should clear the selection and flash the summary")
	}
}
