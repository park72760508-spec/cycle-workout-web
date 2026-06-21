/**
 * RUN 랭킹보드 크루 탭 — CYCLE 클럽 탭 UI·로직 (나의 크루 목록 + 멤버 순위)
 */
/* global React, useState, useEffect, useMemo, useCallback, useRef */
(function () {
  'use strict';
  if (!window.React) return;

  var React = window.React;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useCallback = React.useCallback;
  var useRef = React.useRef;

  function crewApi() { return window.runningRankingCrewTab || {}; }
  function cfg() { return window.runningRankingConfig || {}; }

  function defaultProfileImg() {
    return typeof window.STELVIO_DEFAULT_PROFILE_IMAGE_URL === 'string' && window.STELVIO_DEFAULT_PROFILE_IMAGE_URL
      ? window.STELVIO_DEFAULT_PROFILE_IMAGE_URL
      : 'assets/img/profile-placeholder.svg';
  }

  function pickToggleMarkup(isExp) {
    var icon = isExp ? '−' : '+';
    var label = isExp ? '접어보기' : '펼쳐보기';
    return React.createElement('span', { className: 'stelvio-group-pick-toggle', 'aria-hidden': true },
      React.createElement('span', { className: 'stelvio-group-pick-toggle-icon' }, icon),
      React.createElement('span', { className: 'stelvio-group-pick-toggle-label' }, label)
    );
  }

  function GroupNoticeBlock(props) {
    var gr = props.group;
    var gid = props.groupId;
    var isHost = !!props.isHost;
    var isExpanded = !!props.isExpanded;
    var currentUserId = props.currentUserId;

    var _draft = useState('');
    var draft = _draft[0];
    var setDraft = _draft[1];
    var _saving = useState(false);
    var saving = _saving[0];
    var setSaving = _saving[1];

    var maxLen = crewApi().rankingNoticeMaxLen ? crewApi().rankingNoticeMaxLen() : 500;
    var savedText = gr && gr.rankingNotice && gr.rankingNotice.text != null
      ? String(gr.rankingNotice.text).trim()
      : '';
    var dateLbl = gr && gr.rankingNotice
      ? (crewApi().formatNoticeDate ? crewApi().formatNoticeDate(gr.rankingNotice.updatedAt) : '')
      : '';

    useEffect(function () {
      setDraft(savedText);
    }, [gid, savedText]);

    if (!isExpanded) return null;
    if (!isHost && !savedText) return null;

    function handleSave() {
      if (!gid || !currentUserId || saving) return;
      var text = String(draft || '').slice(0, maxLen);
      setSaving(true);
      var finish = function () { setSaving(false); };
      Promise.resolve()
        .then(function () {
          if (!window.firestoreV9) throw new Error('연결을 확인해 주세요.');
          var svc = window.openRidingGroupService;
          if (!svc || typeof svc.updateRidingGroupRankingNotice !== 'function') {
            return import('./assets/js/openRiding/openRidingGroupService.js').then(function () {
              return window.openRidingGroupService;
            });
          }
          return svc;
        })
        .then(function (svc) {
          if (!svc || typeof svc.updateRidingGroupRankingNotice !== 'function') {
            throw new Error('공지 저장 기능을 불러올 수 없습니다.');
          }
          return svc.updateRidingGroupRankingNotice(window.firestoreV9, currentUserId, gid, text);
        })
        .then(function () {
          if (typeof window.showToast === 'function') window.showToast('공지가 등록되었습니다.', 'success');
        })
        .catch(function (err) {
          if (typeof window.showToast === 'function') {
            window.showToast((err && err.message) || '공지 저장에 실패했습니다.', 'error');
          }
        })
        .finally(finish);
    }

    if (isHost) {
      return React.createElement('div', { className: 'stelvio-group-notice-block', 'data-stelvio-group-notice-root': '1' },
        React.createElement('div', { className: 'stelvio-group-notice-head' },
          React.createElement('span', { className: 'stelvio-group-notice-title' }, '소모임 공지'),
          dateLbl
            ? React.createElement('p', { className: 'stelvio-group-notice-date' }, '작성일 ', dateLbl)
            : React.createElement('p', { className: 'stelvio-group-notice-date stelvio-group-notice-date--muted' }, '아직 등록된 공지가 없습니다')
        ),
        React.createElement('textarea', {
          className: 'stelvio-group-notice-input',
          maxLength: maxLen,
          rows: 4,
          placeholder: '소모임 공지를 입력하세요 (' + maxLen + '자 이내)',
          value: draft,
          onChange: function (e) { setDraft(e.target.value); }
        }),
        React.createElement('div', { className: 'stelvio-group-notice-foot' },
          React.createElement('span', { className: 'stelvio-group-notice-count' }, String(draft.length) + '/' + maxLen),
          React.createElement('button', {
            type: 'button',
            className: 'stelvio-group-notice-save stelvio-purple-btn',
            disabled: saving,
            onClick: handleSave
          }, saving ? '저장 중…' : '공지 등록')
        )
      );
    }

    return React.createElement('div', { className: 'stelvio-group-notice-block', 'data-stelvio-group-notice-root': '1' },
      React.createElement('div', { className: 'stelvio-group-notice-head' },
        React.createElement('span', { className: 'stelvio-group-notice-title' }, '소모임 공지'),
        dateLbl ? React.createElement('p', { className: 'stelvio-group-notice-date' }, '작성일 ', dateLbl) : null
      ),
      React.createElement('p', { className: 'stelvio-group-notice-body' }, savedText)
    );
  }

  function RunningRankingCrewTab(props) {
    var groups = props.groups || [];
    var leaderboardRows = props.leaderboardRows || [];
    var currentUserId = props.currentUserId;
    var viewerIdentity = props.viewerIdentity;
    var gender = props.gender || 'all';
    var category = props.category || 'Supremo';
    var crewMetric = props.crewMetric || 'overall';
    var paceDistance = props.paceDistance || '5k';
    var listFilter = props.listFilter || 'all';
    var socialVer = props.socialVer || 0;
    var rankMovementByKey = props.rankMovementByKey || {};
    var rankMovementSource = props.rankMovementSource || '';
    var rankMovementAsOfSeoul = props.rankMovementAsOfSeoul || '';
    var leaderboardSource = props.leaderboardSource || '';
    var leaderboardAsOfSeoul = props.leaderboardAsOfSeoul || '';

    var _expanded = useState(null);
    var expandedId = _expanded[0];
    var setExpandedId = _expanded[1];

    var _members = useState([]);
    var members = _members[0];
    var setMembers = _members[1];

    var _membersLoading = useState(false);
    var membersLoading = _membersLoading[0];
    var setMembersLoading = _membersLoading[1];

    var membersUnsubRef = useRef(null);
    var GroupMemberRow = window.RunningRankingGroupMemberRow;
    var memberTabId = crewApi().metricToTabId ? crewApi().metricToTabId(crewMetric) : 'overall';
    var memberMetricLabel = crewApi().crewMetricLabel ? crewApi().crewMetricLabel(crewMetric) : '';

    var stopMembersSub = useCallback(function () {
      if (membersUnsubRef.current) {
        try { membersUnsubRef.current(); } catch (e) {}
        membersUnsubRef.current = null;
      }
    }, []);

    useEffect(function () {
      stopMembersSub();
      setMembers([]);
      if (!expandedId) {
        setMembersLoading(false);
        return;
      }
      if (!window.firestoreV9) {
        setMembersLoading(false);
        return;
      }
      setMembersLoading(true);
      function attach(svc) {
        if (!svc || typeof svc.subscribeRidingGroupMembers !== 'function') {
          setMembersLoading(false);
          return;
        }
        try {
          membersUnsubRef.current = svc.subscribeRidingGroupMembers(window.firestoreV9, expandedId, function (rows) {
            setMembers(Array.isArray(rows) ? rows.slice() : []);
            setMembersLoading(false);
          });
        } catch (eSub) {
          setMembersLoading(false);
        }
      }
      if (window.openRidingGroupService) {
        attach(window.openRidingGroupService);
      } else {
        import('./assets/js/openRiding/openRidingGroupService.js')
          .then(function () { attach(window.openRidingGroupService); })
          .catch(function () { setMembersLoading(false); });
      }
      return stopMembersSub;
    }, [expandedId, stopMembersSub]);

    useEffect(function () {
      if (!expandedId) return;
      var keep = {};
      groups.forEach(function (gr) {
        var gid = gr && (gr.groupId || gr.id) ? String(gr.groupId || gr.id) : '';
        if (gid) keep[gid] = true;
      });
      if (!keep[String(expandedId)]) {
        setExpandedId(null);
        setMembers([]);
      }
    }, [groups, expandedId]);

    var memberRankedList = useMemo(function () {
      if (!expandedId || !members.length) return [];
      var list = crewApi().buildCrewMemberRankedList
        ? crewApi().buildCrewMemberRankedList(leaderboardRows, members, {
          metric: crewMetric,
          gender: gender,
          category: category,
          paceDistance: paceDistance,
          movement: {
            rankMovementByKey: rankMovementByKey,
            rankMovementSource: rankMovementSource,
            rankMovementAsOfSeoul: rankMovementAsOfSeoul,
            leaderboardSource: leaderboardSource,
            leaderboardAsOfSeoul: leaderboardAsOfSeoul
          }
        })
        : [];
      if (listFilter === 'interest') {
        var soc = window.runningRankingSocial;
        if (soc && typeof soc.filterRowsByListInterest === 'function') {
          list = soc.filterRowsByListInterest(list, 'interest', currentUserId);
          list = list.map(function (item, idx) {
            return Object.assign({}, item, { rank: idx + 1, boardRank: idx + 1 });
          });
        }
      }
      return list;
    }, [
      expandedId, members, leaderboardRows, crewMetric, gender, category, paceDistance,
      listFilter, currentUserId, rankMovementByKey, rankMovementSource, rankMovementAsOfSeoul,
      leaderboardSource, leaderboardAsOfSeoul
    ]);

    useEffect(function () {
      if (!expandedId || membersLoading || !memberRankedList.length) return;
      var raf = requestAnimationFrame(function () {
        var soc = window.runningRankingSocial;
        if (soc && typeof soc.refreshStarSlots === 'function') {
          soc.refreshStarSlots();
        }
      });
      return function () { cancelAnimationFrame(raf); };
    }, [expandedId, membersLoading, memberRankedList, socialVer, crewMetric, gender, category, listFilter]);

    function toggleGroup(gid) {
      var g = gid != null ? String(gid).trim() : '';
      if (!g) return;
      setExpandedId(function (prev) { return String(prev) === g ? null : g; });
    }

    function isGroupHost(gr) {
      if (!gr || !currentUserId) return false;
      return String(gr.createdBy || '') === String(currentUserId);
    }

    if (!currentUserId) {
      return React.createElement('p', { className: 'stelvio-ranking-empty' },
        '로그인 후 나의 크루(소모임) 랭킹을 확인할 수 있습니다.'
      );
    }

    if (!groups.length) {
      return React.createElement('p', { className: 'stelvio-ranking-empty stelvio-ranking-empty--group' },
        '가입된 승인 러닝 크루가 없습니다.',
        React.createElement('br'),
        '러닝 크루에서 그룹(소모임)에 가입해 보세요.'
      );
    }

    return React.createElement('div', {
      className: 'stelvio-group-tab-root',
      'data-stelvio-group-tab-root': '1'
    },
      groups.map(function (gr) {
        var gid = gr && (gr.groupId || gr.id) ? String(gr.groupId || gr.id) : '';
        if (!gid) return null;
        var rawName = (gr.name || '(이름 없음)').toString();
        var nameG = rawName.length > 15 ? rawName.substring(0, 15) + '..' : rawName;
        var ph = gr.photoUrl && String(gr.photoUrl).trim() ? String(gr.photoUrl).trim() : defaultProfileImg();
        var mc = gr.memberCount;
        var mcShown = mc != null && isFinite(Number(mc)) ? Math.floor(Number(mc)) : '—';
        var isExp = String(expandedId) === gid;
        var rowCls =
          'stelvio-rank-row stelvio-rank-row--my-group stelvio-group-pick-row' +
          (isExp ? ' stelvio-group-pick-row--open' : '');

        var memberBlock = null;
        if (isExp) {
          var membersAriaLabel =
            '선택 크루 멤버 ' + memberMetricLabel + ' 순위' +
            (membersLoading ? ' 로딩' : '');
          if (membersLoading) {
            memberBlock = React.createElement('div', {
              className: 'stelvio-group-members-block',
              role: 'region',
              'aria-label': membersAriaLabel
            },
              React.createElement('p', {
                className: 'stelvio-ranking-empty stelvio-ranking-loading-local',
                style: { margin: '10px 0 10px 12px' }
              }, '멤버 불러오는 중…')
            );
          } else if (!memberRankedList.length) {
            memberBlock = React.createElement('div', {
              className: 'stelvio-group-members-block',
              role: 'region',
              'aria-label': membersAriaLabel
            },
              React.createElement('p', {
                className: 'stelvio-ranking-empty',
                style: { margin: '10px 0 12px 20px', fontSize: '12px' }
              }, !members.length
                ? '등록된 멤버가 없습니다.'
                : (listFilter === 'interest'
                  ? '관심·친구·그룹멤버에 해당하는 멤버가 없습니다.'
                  : '해당 조건에 집계된 멤버가 없습니다.'))
            );
          } else if (GroupMemberRow) {
            memberBlock = React.createElement('div', {
              className: 'stelvio-group-members-block',
              role: 'region',
              'aria-label': membersAriaLabel
            },
              memberRankedList.map(function (item) {
                var rankMetaHtml = crewApi().buildCrewMemberRankMetaHtml
                  ? crewApi().buildCrewMemberRankMetaHtml(item)
                  : (crewApi().buildGroupMemberRankMetaHtml
                    ? crewApi().buildGroupMemberRankMetaHtml(item, leaderboardRows, category)
                    : '');
                return React.createElement(GroupMemberRow, {
                  key: String(item.userId) + '-' + item.rank + '-' + crewMetric + '-' +
                    paceDistance + '-' + (item.valueLabel || '') + '-' + socialVer,
                  item: item,
                  tabId: memberTabId,
                  currentUserId: currentUserId,
                  viewerIdentity: viewerIdentity,
                  listCategory: category,
                  rankMetaHtml: rankMetaHtml,
                  groupRole: item._groupRole
                });
              })
            );
          }
        }

        return React.createElement('div', {
          key: gid,
          className: 'stelvio-group-tab-item',
          'data-stelvio-group-item-id': gid
        },
          React.createElement('button', {
            type: 'button',
            className: rowCls,
            'data-stelvio-group-pick': '1',
            'data-stelvio-group-id': gid,
            'aria-expanded': isExp ? 'true' : 'false',
            onClick: function () { toggleGroup(gid); }
          },
            React.createElement('span', { className: 'stelvio-rank-name stelvio-group-pick-main' },
              React.createElement('span', { className: 'stelvio-group-list-avatar-slot', 'aria-hidden': true },
                React.createElement('span', { className: 'stelvio-rank-avatar' },
                  React.createElement('img', {
                    className: 'stelvio-rank-avatar-img',
                    src: ph,
                    alt: '',
                    width: 30,
                    height: 30,
                    decoding: 'async'
                  })
                )
              ),
              React.createElement('span', { className: 'stelvio-rank-name-text' }, nameG)
            ),
            React.createElement('span', { className: 'stelvio-group-pick-actions' },
              React.createElement('span', { className: 'stelvio-rank-wkg stelvio-group-pick-meta' }, String(mcShown) + '명'),
              pickToggleMarkup(isExp)
            )
          ),
          React.createElement('div', { className: 'stelvio-group-notice-slot' + (isExp ? '' : ' hidden') },
            React.createElement(GroupNoticeBlock, {
              group: gr,
              groupId: gid,
              isHost: isGroupHost(gr),
              isExpanded: isExp,
              currentUserId: currentUserId
            })
          ),
          React.createElement('div', { className: 'stelvio-group-members-slot' }, memberBlock)
        );
      })
    );
  }

  window.RunningRankingCrewTab = RunningRankingCrewTab;
})();
