/** EvalJob 面（B-direct 适配输入）— 切片 5 */

export interface EvalJob {
  items: Array<{
    id: string;
    rev: number;
    prompt_ref: string;
    must_call?: string[];
    required_fields?: Record<string, string[]>;
  }>;
  models: string[];
  repeats: number;
  fake_tools_ref?: string;
}

export interface FrameworkRawResult {
  framework: string;
  rows: Array<{
    item_id: string;
    model: string;
    repeat: number;
    pass: boolean;
    tool_trace?: unknown;
    raw?: unknown;
  }>;
}
