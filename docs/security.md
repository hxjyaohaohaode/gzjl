# 安全与权限

认证使用 Argon2id 密码散列、不可逆 SHA-256 会话令牌、HttpOnly/Secure/SameSite cookie、CSRF token 和登录失败锁定。生产 API 统一启用 Helmet、严格 CORS、请求速率限制、日志敏感字段脱敏、参数 Zod 校验与结构化错误响应。`/healthz` 不依赖数据库，`/readyz` 需要数据库可用。

权限由角色的 grant 表驱动；每次请求都在服务端以 `permission + scopeKind + scopeId` 判定，不能相信路由或前端隐藏。组织级授权可覆盖窄范围，项目和成员范围只能匹配同一对象。团队列表、分析、审批、导出与附件读取均先收敛为调用者可见范围，再查询数据。

Owner 初始化通过 setup token 和 PostgreSQL 事务锁完成，数据库约束确保单组织只能存在一个 Owner。上线后立即轮换 `SETUP_TOKEN`，为 Owner 启用组织的二次认证策略，并定期撤销不再使用的会话。

密码重置使用一次性、只存 SHA-256 哈希的令牌，默认 60 分钟过期。重置令牌仅通过已配置 SMTP 发送，永不在 API 响应或日志中返回；成功重置会消费令牌、清空锁定计数并撤销该用户全部既有会话。生产部署必须配置 `SMTP_HOST` 和 `SMTP_FROM`，可选 `SMTP_USER`/`SMTP_PASSWORD` 用于认证；未配置时 API 以统一的 503 响应失败，不枚举账号。

对象存储必须使用独立、最小权限的 bucket 凭据；bucket 只允许预签名 PUT/GET 所需动作，不设置公开读取。`S3_ENDPOINT` 既是服务端签名端点，也是生产 CSP 中允许的直传 origin。没有对象存储配置时，链接/文本证据可用，文件上传会明确返回不可用而不回退到本地磁盘。

对象存储 CORS 只允许 `WEB_ORIGIN`，方法限于 `PUT` 和 `GET`，请求头限于 `content-type`、`x-amz-checksum-sha256` 与签名所需的 `x-amz-*`；不要使用 `*` origin 或将 bucket 配为公开。上传签名有效期为 15 分钟，下载签名有效期为 5 分钟。
