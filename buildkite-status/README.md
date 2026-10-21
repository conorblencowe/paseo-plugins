# Buildkite status

Shows the Buildkite builds for your workspace's branch in Paseo's explorer sidebar: steps, logs and annotations, with retries and sending failures to an agent. Works with any Buildkite organization your token can see.

```bash
paseo plugin add github:conorblencowe/paseo-plugins:buildkite-status
```

You need a Buildkite API access token with `read_builds` and `read_build_logs`; add `write_builds` to retry, rebuild, cancel and unblock. See [OVERVIEW.md](OVERVIEW.md) for details.
