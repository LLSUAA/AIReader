# 快照存档规范（Snapshot Convention）

## 为什么要快照

正式项目在每次"大改动 / 发版 / 重构"前都应留下一个**可回退、可对比、可审计**的基线。对个人开发者来说，快照 = `git tag` + 一份清单文档，成本极低，收益是：改坏了能精确回到"改之前"，且以后能回答"当时这个版本到底有什么"。

## 什么时候快照

- 发布新版本前（如 `v1.0.0`、`v1.1.0`）；
- 结构性重构前（如引入提取管线、换存储层）；
- 删除/归档代码前（先留基线再清理）。

## 怎么做（三步）

1. **确认工作区干净**：`git status` 无未提交改动（或先提交）。
2. **打标签**：`git tag -a vX.Y.Z -m "描述"`（annotated tag 带说明，推荐）。
3. **写快照清单**：新建 `docs/snapshots/<日期>-v<版本>/SNAPSHOT.md`，至少包含：
   - 对应 tag 与 commit hash；
   - 文件清单 + SHA256（生成方式见下）；
   - 已知问题/遗留债务（从项目报告抄重点）；
   - 验证记录（哪些手工测试做过）。

生成文件哈希的 PowerShell 命令：

```powershell
Get-ChildItem . -Recurse -File | Where-Object { $_.FullName -notmatch '\\\.git\\' } |
  ForEach-Object { $h = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash;
                   "$($_.FullName.Substring((Get-Location).Path.Length + 1))`t$h" }
```

## 回退方法

```powershell
git checkout v1.0.0        # 只查看/临时切回
git checkout -b hotfix v1.0.0   # 从基线开分支修 bug
```

> 注意：`git checkout` 会改变工作区文件，回退前确认没有未提交的重要改动。

## 快照索引

| 版本 | 日期 | 说明 | 位置 |
|------|------|------|------|
| v1.0.0 | 2026-08-02 | 第一轮更新前基线（原始可用版） | `docs/snapshots/2026-08-02-v1.0.0/SNAPSHOT.md` |
