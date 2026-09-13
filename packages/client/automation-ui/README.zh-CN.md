# @workbench/automation-ui

拥有 automation 能力实现及共置双语词典；消费者只使用公开入口，产品保持原有 bundle 与扩展安装顺序。稳定 ID、命令、持久化格式和安装级生命周期保持兼容。测试位于 tests/。

src 拥有自动化表单、主页、导航契约、扩展装配及词典；lib 拥有实际被调用的调度、校验/焦点、信任文案和注册生命周期辅助模块，全部保留 TS/TSX，两处均为浅目录。

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/automation-task-form.tsx` 引用 `lib/automation-invalid-focus.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
