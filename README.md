# iTools 插件仓库

[iTools](https://github.com/jimhy/iTools) 的官方插件。每个插件一个目录，**目录里就是可直接安装的产物**
（`plugin.json` + `index.html` + `assets/`），源码放在 `src/<插件名>/`。

分成两处是为了体积：客户端安装时只拉插件目录那一个子目录，不必把构建工程一起下载。

## 插件

| 目录 | 名称 | 说明 |
|---|---|---|
| [`deskbox/`](deskbox) | 云端笔记 | 树形笔记（可加密上锁）· 待办清单 · 加密密码管家，支持云同步 |

## 从源码构建

```bash
cd src/deskbox
npm install
npm run build      # 产物直接写回 ../../deskbox
```

## 收录到插件市场

市场索引在主仓库的 [`registry/`](https://github.com/jimhy/iTools/tree/main/registry)，
条目须钉死完整 40 位 commit sha —— 客户端只安装那个确切 commit，作者推新代码必须重新提审。
