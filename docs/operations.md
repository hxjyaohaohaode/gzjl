# 生产运维、备份与恢复

## 日常检查

部署后检查 `GET /healthz`、`GET /readyz`、登录、手工录入、计时开始/暂停/结束、提交审核、薪资试算、CSV 导出、AI 不可用降级和 WebSocket 重连。查看 API/Worker 的结构化日志并对 `readyz`、任务失败、导出失败、对象校验隔离和薪资结算失败设置告警。

## 备份

除托管数据库的 PITR 外，每日生成自定义格式逻辑备份，并保存到与主库不同的受控位置。脚本会输出 `.dump` 和对应 SHA-256：

```powershell
pwsh ./scripts/backup.ps1 -DatabaseUrl $env:DATABASE_URL
```

每月至少执行一次隔离环境的恢复演练，并记录恢复时间、校验值和迁移版本。对象存储证据必须由 bucket 的版本化/生命周期策略单独备份；数据库仅保存对象键和哈希。

## 恢复

恢复命令会以 `pg_restore --clean --if-exists` 清空并重建目标库。只允许在已隔离、确认连接字符串无误、已停止目标业务流量且已验证备份 SHA-256 后执行：

```powershell
pwsh ./scripts/restore.ps1 -DatabaseUrl $env:RESTORE_DATABASE_URL -BackupPath ./backups/workbench-YYYYMMDD-HHMMSS.dump -ConfirmRestore
```

恢复后运行 `pnpm db:migrate`（只前进，不回滚迁移）、检查 `readyz`、抽样核验 Owner 唯一性/最近工时/工资运行输入哈希，并将 Web 与 Worker 恢复流量。
# 通知运行边界

提醒 worker 每分钟评估启用的规则。应用内通知会先读取成员同一分类的 `notification_preferences.inAppEnabled`：没有偏好记录时默认发送，显式关闭后不会创建该分类通知。当前已接入该检查的分类包括 `timer_long_running`、`payroll_cutoff_pending`、`ai_report_ready` 与 `ai_report_failed`。通知的 `validUntil` 到期后不会再从 API 返回。

`pushEnabled` 与 `emailEnabled` 是独立渠道意图，不会伪装为已经投递：未配置 VAPID 或邮件渠道时，运行时仅保留可用的应用内通道。上线前应为目标渠道完成凭据配置、订阅注册、失败重试和退订验证。
