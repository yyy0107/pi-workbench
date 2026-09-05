// Adapted from @juicesharp/rpiv-todo 2.9.0 (MIT); see ../LICENSE.
import type { Task } from "../tool/types";

export interface TaskState {
  tasks: Task[];
  nextId: number;
}
