(window.webpackJsonp=window.webpackJsonp||[]).push([[5],{312:function(t,e,n){"use strict";var r=n(0),s=n(20),a=n(9),o=n(2),i=n(27),c=[],l=c.sort,u=o((function(){c.sort(void 0)})),f=o((function(){c.sort(null)})),d=i("sort");r({target:"Array",proto:!0,forced:u||!f||!d},{sort:function(t){return void 0===t?l.call(a(this)):l.call(a(this),s(t))}})},313:function(t,e,n){var r=n(18),s=Date.prototype,a=s.toString,o=s.getTime;new Date(NaN)+""!="Invalid Date"&&r(s,"toString",(function(){var t=o.call(this);return t==t?a.call(this):"Invalid Date"}))},343:function(t,e,n){},423:function(t,e,n){"use strict";n(343)},445:function(t,e,n){"use strict";n.r(e);n(68),n(312),n(44),n(170),n(313);var r={computed:{posts:function(){return this.$site.pages.filter((function(t){return t.path.startsWith("/news/")&&!t.frontmatter.newsIndex})).sort((function(t,e){return new Date(e.frontmatter.date)-new Date(t.frontmatter.date)})).slice(0,3)}}},s=(n(423),n(43)),a=Object(s.a)(r,(function(){var t=this,e=t.$createElement,n=t._self._c||e;return n("div",[t._l(t.posts,(function(e,r){return n("div",{staticClass:"post"},[n("Columns",[n("Column",{attrs:{side:"left"}},[n("h3",[t._v(t._s(e.frontmatter.title))]),t._v(" "),n("NewsPostMeta",{attrs:{date:e.frontmatter.date}})],1),t._v(" "),n("Column",{attrs:{side:"right"}},[n("div",{domProps:{innerHTML:t._s(e.excerpt)}}),t._v(" "),!1!==e.frontmatter.more?n("Button",{attrs:{link:e.path,cssClass:"read-more"}},[t._v("Read more")]):t._e()],1)],1)],1)})),t._v(" "),n("p",{staticClass:"subscribe"},[n("Subscribe"),t._v(" "),n("a",{staticClass:"all-news",attrs:{href:"/news/"}},[t._v("All news")])],1)],2)}),[],!1,null,"a228e400",null);e.default=a.exports}}]);