# 把 PrintShelf 发到 GitHub（零基础指引）

这份文档假设你**从来没用过 GitHub**。跟着做就行，不需要下载任何额外软件——你的电脑上 Git 已经装好了（版本 2.55），截图里那个 "Download GitHub Copilot app" 是 AI 编程助手，跟发布代码无关，不用点。

项目本地已经准备好了：

- ✅ Git 仓库已初始化，分支 `main`，共 3 个提交（最新 `46f4f83`），238 个文件、约 35 MB
- ✅ 版本标签 `v1.0.0` 已打好
- ✅ `.gitignore` 已排除 `data/`（你的真实模型库、打印机访问码）、`dist/`、`node_modules/`
- ✅ 源码 / README / 文档里的真实内网 IP、设备型号已全部换成示例值（2026-11-21 复查通过）
- ✅ `LICENSE`（MIT）和第三方许可声明已就位
- ✅ 完整测试通过：12 套 / 507 条断言 / 0 失败（**历史基线数字，以当前 `npm run selftest` 实际输出为准**；当前 IPC 契约口径为 **127 方法 / 20 事件**）
- ✅ 发布包已生成：`dist/3MF模型管理器-1.1.1-portable.zip`（约 113 MB）与 `dist/3MF模型管理器-1.1.1-setup.exe`；绿色版目录为 `dist/3MF模型管理器-1.1.1-win-x64/`。版本号取自 `package.json` 的 `version`，1.0.x 的英文命名产物属历史遗留。

### 你需要提前准备的东西

| 项目 | 说明 | 是否必须 |
| --- | --- | --- |
| GitHub 账号 | https://github.com 免费注册 | 必须 |
| 用户名 | 会成为 `github.com/用户名`，注册时就定了 | 必须 |
| 邮箱 | 注册验证用；可用 GitHub 隐私邮箱代替公开 | 必须 |
| 仓库名 | 建议就叫 `PrintShelf` | 必须 |
| 仓库地址 | 建完仓库后形如 `https://github.com/用户名/PrintShelf.git` | 必须 |
| 访问令牌（PAT） | 只有 push 不弹浏览器登录时才需要 | 按需 |
| 公开还是私有 | Public 别人能看；Private 只有你能看 | 需要决定 |

> 不需要：不需要买任何服务，不需要下载 GitHub Copilot，也不需要把密码告诉任何人。

---

## 第 0 步：先注册 GitHub 账号

1. 打开 https://github.com
2. 点右上角的 **Sign up**（注册），不是 Sign in
3. 用邮箱注册，设密码，验证邮箱
4. 起一个用户名，比如 `yourname-3d`（这会成为你主页地址的一部分：`github.com/yourname-3d`）

记住你的**用户名**，后面要用。

---

## 第 1 步：在 GitHub 上新建一个空仓库

1. 登录后，点右上角 **+** → **New repository**
2. 填写：
   - **Repository name**：`PrintShelf`（或你想要的名字）
   - **Description**：`本地 3MF 模型库 —— 扫描、分类、预览、去重、一键送切片软件`
   - **Public** / **Private**：选 Public 别人才看得到（选 Private 只有你自己能看到）
   - ⚠️ **不要**勾选 "Add a README file" / "Add .gitignore" / "Choose a license" —— 本地都已经有了，勾了会冲突
3. 点 **Create repository**

创建后会看到一个页面，上面有一堆命令，标题类似 "…or push an existing repository from the command line"。**先别照着抄**，用下面我给你的命令（因为你的分支叫 `main`）。

---

## 第 2 步：把本地代码推上去

### 2.1 改提交作者（重要）

现在提交记录里显示的是占位符 `PrintShelf`。注册完 GitHub 后，改成你自己的名字和邮箱：

```bash
# 进入你克隆下来的项目目录（路径按自己的实际情况调整）
cd <项目目录>

git config user.name "你的GitHub用户名"
git config user.email "你的注册邮箱"

# 把已有的 3 个提交全部改成你的身份（不是只改最后一个）
git rebase --root --exec "git commit --amend --reset-author --no-edit"
```

执行后会看到 `Successfully rebased and updated refs/heads/main.`，再用 `git log --format="%an <%ae>"` 确认作者已经变成你。

> 如果不想公开你的真实邮箱，GitHub 提供隐私邮箱：在 GitHub → Settings → Emails → 勾选 "Keep my email addresses private"，会给你一个类似 `12345678+yourname@users.noreply.github.com` 的地址，用它代替上面的注册邮箱。
>
> 注意：`v1.0.0` 标签是在改写作者之前打的（历史标签）。如果希望它也指向改写后的提交，改完作者后执行一次：`git tag -f -a v1.0.0 -m "PrintShelf v1.0.0 — 首个公开版本"`。发布当前 1.1.0 版本时请另打 `v1.1.0` 标签，不要复用旧标签。

### 2.2 关联远程仓库并推送

在 GitHub 新建仓库的页面上，复制仓库地址，形如：

```
https://github.com/你的用户名/PrintShelf.git
```

然后在终端（Git Bash / PowerShell 都行）执行：

```bash
cd <项目目录>

# 关联远程仓库（把 URL 换成你自己的）
git remote add origin https://github.com/你的用户名/PrintShelf.git

# 推送到 GitHub
git push -u origin main

# 标签不会跟着 main 自动推，单独推一次
git push origin v1.0.0
```

第一次推送会弹出登录窗口：

- Windows 通常会弹 **Git Credential Manager** 的浏览器登录页 → 点登录、授权即可
- 如果没弹，GitHub 早已不支持账号密码直接 push，需要用 **Personal Access Token（个人访问令牌）**：
  1. GitHub → 头像 → Settings → Developer settings → Personal access tokens → Tokens (classic)
  2. Generate new token (classic)，勾选 `repo` 权限，生成后**立刻复制**（只显示一次）
  3. 再执行 `git push`，用户名填 GitHub 用户名，密码粘贴那个 token

推送成功后刷新 GitHub 仓库页面，就能看到全部代码了。

---

## 第 3 步：让仓库看起来像样（可选但推荐）

### 加 topics（标签）
在仓库页面右侧 **About** 点齿轮图标，添加标签：
`electron`, `3mf`, `3d-printing`, `bambu-lab`, `snapmaker`, `desktop-app`, `offline`

### 上传 Release（让别人直接下载 exe）

GitHub 的 Release 可以放安装包，别人不用装 Node 也能用：

1. 仓库页面右侧 **Releases** → **Create a new release**
2. **Choose a tag** 里选当前版本对应的 tag（如 `v1.1.0`；若尚未创建，先在 GitHub 上新建该 tag 并把本地标签推上去。仓库里已有的 `v1.0.0` 是历史标签）
3. Title 填 `3MF模型管理器 1.1.1`
4. 把 `dist/3MF模型管理器-1.1.1-portable.zip`（约 113 MB）拖进附件区；也可以同时附上 `dist/3MF模型管理器-1.1.1-setup.exe`
5. 附件名请改成英文（如 `3MF-Model-Manager-1.1.1-portable.zip`）：curl 上传中文名会被编码成乱码，网页拖拽也可能被转义
5. 写几句说明，点 **Publish release**

关于大小限制，说清楚免得担心：

- **Release 附件**单文件上限是 **2 GB**，我们的 113 MB 完全没问题。
- **Git 仓库本体**里单文件超过 **100 MB** 才会被拒绝（要用 Git LFS）；我们的 `dist/` 根本没进仓库（被 `.gitignore` 排除），所以不会触发。

> 如果以后想传绿色版目录（270 MB），建议先用 7-Zip 压成 zip 再传，别传散文件夹。

---

## 以后改了代码怎么更新

每次改完代码，执行三条命令：

```bash
cd <项目目录>

git add -A
git commit -m "简单描述这次改了什么"
git push
```

就这么简单。`git push` 不用再加 `-u origin main`，Git 已经记住了。

---

## 常用命令速查

| 命令 | 作用 |
| --- | --- |
| `git status` | 看哪些文件改了、哪些还没提交 |
| `git add -A` | 把所有改动加入待提交 |
| `git commit -m "说明"` | 提交（存一个存档点） |
| `git push` | 上传到 GitHub |
| `git pull` | 从 GitHub 拉最新代码（换电脑时用） |
| `git log --oneline` | 看提交历史 |

---

## 常见坑

1. **push 时报 `remote: Repository not found`** → 仓库地址写错了，或仓库是 Private 但你没登录。用 `git remote -v` 检查地址。
2. **push 一直要密码** → GitHub 不支持密码了，要用 token（见 2.2）。
3. **不小心把 `data/` 传上去了** → 立刻去 GitHub 仓库删除文件，并且**改掉你的打印机访问码**（`data/settings.json` 里的）。已经 push 的敏感信息即使删除也会留在历史里，最稳妥是改凭据。
4. **文件太多太大推不动** → 检查 `.gitignore` 是否生效：`git status --short` 里不应该出现 `data/`、`dist/`、`node_modules/`。
5. **中文文件名乱码** → Git Bash 里正常，PowerShell 里可能显示转义后的字符，不影响实际文件。

---

## 检查清单（推送前对照）

```bash
cd <项目目录>
git status --short    # 应该没有 data/ dist/ node_modules/ 开头的文件
git log --oneline -3  # 应该看到 3 个提交
git tag -l            # 应该看到 v1.0.0
```

输出里如果看到以下任何一项，说明 `.gitignore` 没生效，先别 push：

- `data/` 开头的文件
- `dist/` 开头的文件
- `node_modules/` 开头的文件
- 任何 `.log` 文件

正常情况下应该是干净的（没有输出），或者只有你刚改的几个源码文件。
