# 薄肌多人版部署

同一份代码支持用户自行注册，各自保存身体资料、饮食和照片。没有写死的用户人数上限。5 人只是初始使用规模；新用户增加时无需修改代码或逐个创建账号。当前交付是单实例部署版本，外网部署尚未执行。

## 你现在需要准备什么

准备一台有持久磁盘的 Linux 云服务器、一个域名，以及服务端使用的 DeepSeek API Key。服务器所在地区、入网手续和域名要求按云服务商的部署指引办理。域名解析到服务器公网 IP，开放 80/443 端口。不要把电脑上的 `127.0.0.1:3000` 发给别人。

## 推荐操作：Docker Compose

服务器安装好 Docker Engine 和 Compose 后，把仓库代码放到 `/opt/boji`。不要上传本机密钥文件、`.env` 或 `data/`。在该目录执行：

```sh
cp deploy/production.env.example .env
chmod 600 .env
```

用文本编辑器打开 `.env`，填写 `DOMAIN`（例如 `coach.example.com`，不加 https）和 `DEEPSEEK_API_KEY`。保留 `REGISTRATION_MODE=open`，然后执行：

```sh
docker compose up -d --build
docker compose ps
```

镜像构建会先跑测试，通过后才生成运行镜像。应用以普通用户运行，账号、数据库和照片保存在 `app_data` 持久卷；应用端口只在容器网络中开放。Caddy 对外提供 HTTPS，并单独持久化证书。代理覆盖 `X-Real-IP`，应用仅信任该代理的固定内网地址，SSE 立即转发。[Caddy 代理文档](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

打开 `https://你的域名`。用户点击「免费创建账号」，设置用户名和密码，完成建档即可使用。直接分享这个网址即可，无需事先告诉程序会有几个人。

### 仅站长需要的可选操作

新注册账号一律是普通用户，不能接管旧本机数据。若要创建站长并迁入以前的记录，运行一次：

```sh
docker compose exec app node admin.js owner
```

在 `https://你的域名/login#invite` 使用站长邀请码创建账号。邀请码 72 小时内使用一次，不能发给普通用户。旧资料迁移可使用应用内的导出/导入；整个旧数据库的迁移需要单独操作并验证备份。

### 更新和备份

更新代码前先备份，再运行 `docker compose up -d --build`。不要使用 `docker compose down -v`，它会删除持久卷。

完整备份要同时包含账户库、每人数据库和照片。以下命令短暂停止应用，复制到当前目录后重新启动；目录含私人资料，放在受限位置，并再复制一份到服务器之外。

```sh
backup_dir="./backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
chmod 700 backups "$backup_dir"
docker compose stop app
docker compose cp app:/app/data "$backup_dir/data"
docker compose start app
```

恢复时先停服务，把备份写回 `app_data`，恢复 `node` 用户的读写权限，再启动。在独立环境验证恢复后的登录、资料、餐食和照片，不能只检查文件存在。

## 可配置项

这些是资源和费用限制，均不是注册人数限制。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `REGISTRATION_MODE` | `open` | `open` 自行注册；`invite` 邀请注册；`closed` 暂停普通注册。站长引导邀请码在三种模式均可使用。 |
| `DAILY_MODEL_LIMIT` | `30` | 单账号每天 AI 请求次数。 |
| `GLOBAL_DAILY_MODEL_LIMIT` | `1000` | 全站每天 AI 请求次数，UTC 午夜重置。失败的已发起请求也占次数；照片可能调用两个模型，次数不是金额上限。 |
| `MODEL_CONCURRENCY` | `10` | 同时运行的 AI 请求数；超出返回可重试的 503，不无限排队。 |
| `PASSWORD_CONCURRENCY` | `4` | 同时处理的密码任务数；超出提示稍后重试。 |
| `STORE_CACHE_LIMIT` | `64` | 同时打开的用户数据库连接上限；空闲连接可回收，活跃操作持有租约。 |
| `STORE_IDLE_MS` | `300000` | 空闲连接回收时间。 |
| `DATA_DIR` | 项目下 `data/` | 持久数据路径；Docker 已设为 `/app/data`，管理员命令也使用同一目录。 |
| `PUBLIC_ORIGIN` | 本地从请求推导 | 公网完整站点地址；Compose 自动由 DOMAIN 设置。 |
| `TRUSTED_PROXY_IPS` | 空 | 仅信任这些直接代理 IP，不接受任意来源伪造的代理头；Compose 已设置。 |

修改 Compose 中已映射的配置后执行 `docker compose up -d`。配置其他可选项时，先在 `compose.yaml` 的 `app.environment` 添加对应映射。额度按站点预算调整；访问量增加后，结合 CPU、内存、磁盘、实际模型速率和延迟调整并发。

## 不使用 Docker 的方式

可使用 Node.js 24 或更新版本，执行 `npm test` 后，通过 `deploy/boji.service.example` 和 `deploy/Caddyfile.example` 部署。Node 使用内置 SQLite，部署前必须在所选运行时通过测试。[Node SQLite 文档](https://nodejs.org/api/sqlite.html)

systemd 模板将数据放到 `/var/lib/boji`，代码放在 `/opt/boji`。在受限的 `/etc/boji.env` 配置密钥、`PUBLIC_ORIGIN=https://你的域名`、`TRUSTED_PROXY_IPS=127.0.0.1,::1,::ffff:127.0.0.1` 和注册策略。Node 监听 `127.0.0.1:3000`，只通过 Caddy 对外提供服务。管理员命令也要带相同的 `DATA_DIR=/var/lib/boji`；根据服务器实际 Node 安装位置调整 `ExecStart`。

## 上线验收与扩展边界

上线后检查 HTTPS、注册、登录、独立建档、真实 DeepSeek 记餐、历史修改/删除、退出、手机页面，以及备份恢复。公共 `/healthz` 仅表示进程存活，不表示 DeepSeek 余额或业务正常。

当前自动化覆盖 8 账号同站注册与并发、跨用户隔离、会话持久化、限流和分页。模型响应使用模拟数据，这不构成云服务器的吞吐量承诺。公网验收尚未执行；Docker 镜像需在实际服务器构建运行。

当前为一个 Node 进程和本机持久磁盘。单用户写锁、AI 并发和连接租约都在进程内，不要开多个副本共享这套 SQLite 数据。需要多实例时，迁移到集中数据库、共享幂等/任务状态和限流、对象存储，并补充监控、压测和自动恢复。第 6 位用户注册无需再改业务代码。

账号目前没有自助找回密码和邮箱验证；完整账号注销流程、PRD 场景的真实使用验收及发布指标仍在开发计划中。本次架构回归不代表所有产品验收均已完成。
