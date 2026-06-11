/**
 * 크루(소모임) 탭 — 그룹별 멤버 UID 로드
 */
(function () {
  'use strict';

  /**
   * @param {object[]} groupRows
   * @returns {Promise<object[]>}
   */
  function enrichGroupsWithMemberIds(groupRows) {
    if (!groupRows || !groupRows.length) return Promise.resolve([]);
    if (!window.firestoreV9) return Promise.resolve(groupRows);

    var svc = window.openRidingGroupService;
    var loadSvc = svc
      ? Promise.resolve(svc)
      : import('./assets/js/openRiding/openRidingGroupService.js').then(function () {
          return window.openRidingGroupService;
        });

    return loadSvc.then(function (service) {
      if (!service || typeof service.fetchRidingGroupMembersList !== 'function') {
        return groupRows;
      }
      var db = window.firestoreV9;
      return Promise.all(
        groupRows.map(function (gr) {
          var gid = gr && (gr.groupId || gr.id) ? String(gr.groupId || gr.id) : '';
          if (!gid) return Promise.resolve(gr);
          return service.fetchRidingGroupMembersList(db, gid).then(function (members) {
            var ids = (members || [])
              .map(function (m) {
                return m && (m.userId || m.uid || m.id) ? String(m.userId || m.uid || m.id) : '';
              })
              .filter(Boolean);
            return Object.assign({}, gr, { memberUserIds: ids });
          }).catch(function () {
            return gr;
          });
        })
      );
    }).catch(function () {
      return groupRows;
    });
  }

  window.runningRankingCrew = {
    enrichGroupsWithMemberIds: enrichGroupsWithMemberIds
  };
})();
