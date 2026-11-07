#!/bin/sh
# COMPETEN-DIG-001 proof of concept. Runs one command in this container and reports what the whole container used, from its own cgroup:
# wall time, CPU seconds, peak memory (memory.peak includes file cache), peak anonymous memory (sampled every 200 ms, what cannot be dropped), and any kill for memory.
# usage: measure.sh <label> <outdir> <command...>
label=$1; out=$2; shift 2
cg=/sys/fs/cgroup
peak_anon=0
( while :; do
    while read -r k v; do
      if [ "$k" = anon ]; then
        if [ "$v" -gt "$(cat /tmp/.peak_anon 2>/dev/null || echo 0)" ]; then echo "$v" > /tmp/.peak_anon; fi
        break
      fi
    done < $cg/memory.stat
    sleep 0.2
  done ) &
sampler=$!
start=$(date +%s%N)
"$@"
rc=$?
end=$(date +%s%N)
kill $sampler 2>/dev/null
usage=0
while read -r k v; do [ "$k" = usage_usec ] && usage=$v; done < $cg/cpu.stat
ooms=0
while read -r k v; do [ "$k" = oom_kill ] && ooms=$v; done < $cg/memory.events
peak=$(cat $cg/memory.peak)
anon=$(cat /tmp/.peak_anon 2>/dev/null || echo 0)
printf '{"label":"%s","exit":%s,"wallMs":%s,"cpuMs":%s,"peakMb":%s,"peakAnonMb":%s,"oomKills":%s}\n' "$label" "$rc" "$(( (end-start)/1000000 ))" "$(( usage/1000 ))" "$(( peak/1048576 ))" "$(( anon/1048576 ))" "$ooms" | tee "$out/$label.metrics.json"
exit 0
