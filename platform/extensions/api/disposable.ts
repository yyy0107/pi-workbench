/**
 * 扩展拥有资源的统一清理协议。
 *
 * Registry 注册、事件监听、计时器和外部订阅都应转换为 Disposable。实现应尽量保证
 * `dispose()` 幂等，以便扩展回滚、热替换和 Provider 卸载共享同一条清理路径。
 */
export interface Disposable {
  /** 立即释放资源；清理失败时允许抛错，由上层生命周期聚合或上报。 */
  dispose(): void;
}

/**
 * 将清理回调包装成幂等 Disposable。
 *
 * 无论 `dispose()` 被调用多少次，回调最多执行一次。适合包装 DOM listener、timer、订阅以及
 * 其他没有原生 Disposable 接口的资源。
 */
export function createDisposable(dispose: () => void): Disposable {
  let disposed = false;

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      dispose();
    },
  };
}

/**
 * 按输入的反向顺序释放全部资源。
 *
 * 即使某个资源清理失败，剩余资源仍会继续释放。一个错误会原样抛出；多个错误会组成
 * `AggregateError`。反向顺序与 Extension setup 的资源创建顺序相配，便于先拆除依赖者。
 */
export function disposeAll(disposables: Iterable<Disposable>): void {
  const errors: unknown[] = [];

  for (const disposable of Array.from(disposables).reverse()) {
    try {
      disposable.dispose();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "Multiple extension disposables failed");
  }
}
