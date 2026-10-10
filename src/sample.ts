export const sample = [
  '{"id":"trace_01","model":"claude-sonnet","messages":[{"role":"user","content":"Find the weather in Kyoto."},{"role":"assistant","tool_calls":[{"name":"weather","arguments":{"city":"Kyoto","units":"celsius"}}]}],"metadata":{"split":"evaluation","tags":["tool-use","travel"],"verified":true},"latency_ms":842}',
  '{"id":"trace_02","model":"gpt-4.1","messages":[{"role":"user","content":"你好，帮我整理这份数据。"},{"role":"assistant","content":"当然，我们从字段结构开始。"}],"metadata":{"split":"training","language":"zh-CN"},"score":0.97,"reviewed":false,"notes":null}',
  '{"id":"trace_03","status":"success","metrics":{"tokens":1280,"cost_usd":0.0032},"events":[{"type":"start","time":0},{"type":"tool_result","time":420},{"type":"complete","time":842}]}',
  '{"id":"trace_04","status": "incomplete", "value": }',
  '{"id":"trace_05","large_id":9007199254740993,"matrix":[[1,2,3],[4,5,6]],"source":{"file":"evaluation.jsonl","line":5},"ok":true}',
].join("\n");
