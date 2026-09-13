# 公开能力合同

- 新包默认公开扩展/真实组件；需要纯模型的消费者使用src组织的 `./model` 或 `./models`，不能直接export lib路径为package目标，也不能跨包引用src/lib内部文件。
- ui-model-selection保留selector/models/reasoning的语义；ui-token-usage保留token-usage能力。旧ui-agent-controls出口在所有消费者迁完后删除。
- ui-settings保留request/surface/sidebar/sidebar-rail；theme公开background/background-image/color-picker与CSS，general只贡献设置项。不复制设置registry、locale/runtime或appearance-store。
- ui-tool的Context及policy唯一；总message presentation在conversation，ToolCall/ToolGroup/timeline均取新owner。跨组件标签通过i18n描述符或props传递，不让ui-tool加载conversation bundle。
- ui-todo提供模型入口，ui-user-questions提供原renderer/overlay扩展；稳定slot/tool/extension/preferences ID保持。Side-chat在Shell原组原位置安装，直接消费conversation视图，不由conversation回导。
- 每个新词典使用src/i18n/{index,en-US,zh-CN}.ts和共享useI18n(bundle)，bundle ID唯一；现有语义键与插值原样迁移。从旧bundle删除对应键，公共设置分组键仍归ui-settings；Shell/Pi产品总装只安装一次。
- CSS切片按原顺序聚合；完整文件尽量原样移动，tokens/Portal区域/主题密度圆角/Observer与timer清理保持。不能因拆包改变UI挂载层级或重新安装Provider。
- 所有现有测试都有去向；混合测试可留原装配包，修改为公开imports。UI/DOM/fake DOM/渲染/交互用例excluded-by-user；文件后缀不代表可运行。
