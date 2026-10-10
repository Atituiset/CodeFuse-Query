import { defineConfig } from 'vitepress'

const base = '/CodeFuse-Query/'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: 'zh-CN',
  title: 'CodeFuse-Query 深度指南',
  titleTemplate: '从入门实践到源码级剖析',
  description:
    'CodeFuse-Query 入门级与进阶级文档：从核心概念（COREF 与 Gödel）、安装与第一个查询，到编译器前端、抽取器源码、性能调优与平台化二次开发，含千万行级 C/C++ 电信系统适用性评估。',

  base,
  lastUpdated: true,
  cleanUrls: true,
  srcExclude: ['README.md'],

  markdown: {
    // shiki 3.x 不再内置 cuda 语法, 用 cpp 高亮兜底
    languageAlias: { cuda: 'cpp' },
  },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['meta', { name: 'theme-color', content: '#2e7d5b', media: '(prefers-color-scheme: light)' }],
    ['meta', { name: 'theme-color', content: '#18191c', media: '(prefers-color-scheme: dark)' }],
    ['meta', { property: 'og:title', content: 'CodeFuse-Query 深度指南' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'CodeFuse-Query 入门级与进阶级文档：核心概念、抽取器源码剖析、性能调优、千万行级 C/C++ 电信系统适用性评估。',
      },
    ],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
    // 学习笔记悬浮组件（localStorage），VitePress SPA 路由切换由 theme/index.ts 通知其重挂载
    ['script', { src: `${base}notes.js` }],
  ],

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: '/favicon.svg',

    nav: [
      { text: '首页', link: '/' },
      { text: '序言', link: '/intro' },
      { text: '入门指南', link: '/beginner/01-overview' },
      { text: '进阶指南', link: '/advanced/07-godel-language' },
    ],

    sidebar: [
      { text: '序言', link: '/intro' },
      {
        text: '入门级指南',
        collapsed: false,
        items: [
          { text: '第 1 章 什么是 CodeFuse-Query', link: '/beginner/01-overview' },
          { text: '第 2 章 核心概念：COREF 与 Gödel', link: '/beginner/02-core-concepts' },
          { text: '第 3 章 安装与配置', link: '/beginner/03-installation' },
          { text: '第 4 章 第一个查询', link: '/beginner/04-first-query' },
          { text: '第 5 章 Sparrow CLI 命令详解', link: '/beginner/05-cli-commands' },
          { text: '第 6 章 典型分析示例', link: '/beginner/06-examples' },
        ],
      },
      {
        text: '进阶级指南（源码级）',
        collapsed: false,
        items: [
          { text: '第 7 章 Gödel 语言深入', link: '/advanced/07-godel-language' },
          { text: '第 8 章 编译器前端：五层架构剖析', link: '/advanced/08-compiler-frontend' },
          { text: '第 9 章 名称修饰与 Soufflé 代码生成', link: '/advanced/09-name-mangling' },
          { text: '第 10 章 COREF 模型与 oid/URI 机制', link: '/advanced/10-oid-uri' },
          { text: '第 11 章 C/C++ 抽取器源码剖析', link: '/advanced/11-cfamily-extractor' },
          { text: '第 12 章 Java 抽取器与成熟度对比', link: '/advanced/12-java-extractor' },
          { text: '第 13 章 性能调优与大规模查询', link: '/advanced/13-performance' },
          { text: '第 14 章 查询打包、合并与 SARIF 输出', link: '/advanced/14-packaging' },
          { text: '第 15 章 平台化与二次开发', link: '/advanced/15-extension' },
        ],
      },
      {
        text: '专项评估',
        collapsed: false,
        items: [
          { text: '千万行级 C/C++ 电信系统适用性评估', link: '/telecom/applicability' },
        ],
      },
      {
        text: 'LLM 代码审核集成',
        collapsed: false,
        items: [
          { text: '第 16 章 与 mcp-language-server 的结合', link: '/llm/16-integration' },
          { text: '第 17 章 结合落地路线与验证', link: '/llm/17-roadmap' },
        ],
      },
    ],

    outline: {
      level: [2, 3],
      label: '本页大纲',
    },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '无法找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },

    editLink: {
      pattern: 'https://github.com/Atituiset/CodeFuse-Query/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/Atituiset/CodeFuse-Query' }],

    docFooter: { prev: '上一页', next: '下一页' },

    lastUpdated: {
      text: '最后更新于',
      formatOptions: { dateStyle: 'short', timeStyle: 'short' },
    },

    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    skipToContentLabel: '跳转到内容',

    footer: {
      message: '基于开源许可发布',
      copyright: 'Copyright © 2026 CodeFuse-Query 深度指南',
    },
  },
})
