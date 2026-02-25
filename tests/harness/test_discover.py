"""Tests for discover.sh machine discovery script."""
from __future__ import annotations

import json
import os
import subprocess

SCRIPT = os.path.join(os.path.dirname(__file__), '..', '..', 'harness', 'scripts', 'discover.sh')


def run_discover_json():
    """Run discover.sh --json and return parsed dict."""
    result = subprocess.run(
        ['bash', SCRIPT, '--json'],
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, f"discover.sh failed: {result.stderr}"
    return json.loads(result.stdout.strip())


class TestJsonOutput:
    def test_required_fields(self):
        data = run_discover_json()
        for key in ('host', 'os', 'arch', 'cpu', 'ram', 'disk_used', 'shell',
                     'languages', 'tools', 'package_managers', 'repos'):
            assert key in data, f"missing field: {key}"

    def test_new_fields_present(self):
        data = run_discover_json()
        for key in ('git_user', 'git_email', 'display', 'ssh_keys',
                     'cloud_clis', 'browsers'):
            assert key in data, f"missing new field: {key}"

    def test_ssh_keys_is_int(self):
        data = run_discover_json()
        assert isinstance(data['ssh_keys'], int)

    def test_arrays_are_lists(self):
        data = run_discover_json()
        for key in ('tools', 'cloud_clis', 'browsers', 'package_managers', 'repos'):
            assert isinstance(data[key], list), f"{key} should be a list"

    def test_languages_is_dict(self):
        data = run_discover_json()
        assert isinstance(data['languages'], dict)

    def test_host_is_nonempty(self):
        data = run_discover_json()
        assert len(data['host']) > 0

    def test_node_detected(self):
        """Node.js is required for relaygent, so it should always be detected."""
        data = run_discover_json()
        assert 'node' in data['languages']
