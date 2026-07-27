/**
 * demo 用假 Fold：完成后再 TodoStarted 计入 ignored_events。
 * 事件可用 type 或 Kind 字段。
 */
export function foldTodos(events) {
  const todos = {};
  let ignored_events = 0;
  for (const e of events) {
    const kind = e.type ?? e.Kind;
    const id = e.todo_id;
    if (kind === 'TodoAdded') {
      todos[id] = { title: e.title, state: 'Pending' };
    } else if (kind === 'TodoStarted') {
      const t = todos[id];
      if (!t) continue;
      if (t.state === 'Completed') ignored_events += 1;
      else t.state = 'InProgress';
    } else if (kind === 'TodoCompleted') {
      const t = todos[id];
      if (!t) continue;
      t.state = 'Completed';
      t.completed_at = e.at;
    }
  }
  return { todos, ignored_events };
}
