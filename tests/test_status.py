"""Documented status combination:  REJECTED > RETURNED > MORE INFO NEEDED > ACTION REQUIRED > APPROVED
   * any active reject (automatic and not dismissed, or manual)  -> REJECTED
   * any active return (automatic and not dismissed, or manual)  -> at least RETURNED
   * dismissed automatic reasons stay visible but do not count
"""
import pytest

from rules_engine import (STATUS_ACTION, STATUS_APPROVED, STATUS_NEED_INFO, STATUS_REJECTED, STATUS_RETURNED,
                          combine_status)

A_REJ = {"key": "flag:x", "kind": "reject"}
A_RET = {"key": "tx_month", "kind": "return"}
A_ACT = {"key": "rider", "kind": "action"}
M_REJ = {"tid": "rej.01", "kind": "reject"}
M_RET = {"tid": "stm.01", "kind": "return"}
MISSING = [("mrp", "?")]


def st(auto=(), manual=(), dismissed=(), missing=()):
    return combine_status(list(auto), list(manual), list(dismissed), list(missing))["status"]


def test_nothing_is_approved():
    assert st() == STATUS_APPROVED


@pytest.mark.parametrize("auto,manual,missing,expected", [
    ([A_ACT], [], [], STATUS_ACTION),
    ([A_ACT], [], MISSING, STATUS_NEED_INFO),               # MORE INFO > ACTION
    ([], [], MISSING, STATUS_NEED_INFO),
    ([A_RET], [], MISSING, STATUS_RETURNED),                # RETURNED > MORE INFO
    ([A_ACT, A_RET], [], [], STATUS_RETURNED),
    ([A_RET, A_REJ], [], [], STATUS_REJECTED),              # REJECTED > RETURNED
    ([A_REJ, A_ACT], [], MISSING, STATUS_REJECTED),
])
def test_priority_order_automatic(auto, manual, missing, expected):
    assert st(auto, manual, missing=missing) == expected


def test_any_manual_reject_forces_rejected():
    assert st([], [M_REJ]) == STATUS_REJECTED
    assert st([A_ACT, A_RET], [M_REJ], missing=MISSING) == STATUS_REJECTED


def test_any_manual_return_forces_at_least_returned():
    assert st([], [M_RET]) == STATUS_RETURNED
    assert st([A_ACT], [M_RET], missing=MISSING) == STATUS_RETURNED
    assert st([A_REJ], [M_RET]) == STATUS_REJECTED           # ... "at least": a reject still wins


def test_dismissed_automatic_reasons_do_not_count():
    assert st([A_REJ], dismissed=["flag:x"]) == STATUS_APPROVED
    assert st([A_REJ, A_RET], dismissed=["flag:x"]) == STATUS_RETURNED
    assert st([A_REJ, A_RET], dismissed=["flag:x", "tx_month"]) == STATUS_APPROVED
    assert st([A_ACT], dismissed=["rider"]) == STATUS_APPROVED


def test_dismissing_does_not_remove_manual_reasons_or_missing_info():
    assert st([A_REJ], [M_RET], dismissed=["flag:x"]) == STATUS_RETURNED
    assert st([A_RET], dismissed=["tx_month"], missing=MISSING) == STATUS_NEED_INFO


def test_unknown_dismissed_key_is_ignored():
    r = combine_status([A_RET], [], ["nope"], [])
    assert r["status"] == STATUS_RETURNED and r["dismissed"] == []


def test_detail_counts_active_reasons():
    r = combine_status([A_REJ, A_RET, A_ACT], [M_RET], ["flag:x"], [])
    assert r["active"] == {"reject": 0, "return": 2, "action": 1} and r["dismissed"] == ["flag:x"]
