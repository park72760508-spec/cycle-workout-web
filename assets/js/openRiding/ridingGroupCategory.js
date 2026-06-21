/**
 * 소모임(클럽/크루) CYCLE|RUN 카테고리 — 랭킹·클럽하우스 공통
 * - Firestore category 미기록(레거시) 시 방장 users.category/sport_category 로 RUN 추론
 */
(function (global) {
  'use strict';

  var RUN = 'RUN';
  var CYCLE = 'CYCLE';
  var ownerCatCache = Object.create(null);

  function normalizeRidingGroupCategory(raw) {
    var c = raw != null ? String(raw).trim().toUpperCase() : '';
    return c === RUN ? RUN : CYCLE;
  }

  function normalizeOwnerSportCategory(raw) {
    if (raw == null || String(raw).trim() === '') return null;
    if (typeof global.normalizeUserSportCategory === 'function') {
      return global.normalizeUserSportCategory(raw);
    }
    var c = String(raw).trim().toUpperCase();
    return c === RUN ? RUN : CYCLE;
  }

  function extractRidingGroupCategoryRaw(group) {
    if (!group || typeof group !== 'object') return null;
    var fields = ['category', 'sportCategory', 'sport_category', 'moimCategory'];
    for (var i = 0; i < fields.length; i++) {
      var v = group[fields[i]];
      if (v != null && String(v).trim() !== '') return v;
    }
    return null;
  }

  function hasExplicitRidingGroupCategory(group) {
    if (!group) return false;
    if (group.categoryExplicit === true) return true;
    return extractRidingGroupCategoryRaw(group) != null;
  }

  function resolveRidingGroupCategoryFromGroup(group) {
    if (!group) return CYCLE;
    if (group.resolvedCategory === RUN || group.resolvedCategory === CYCLE) {
      return group.resolvedCategory;
    }
    if (hasExplicitRidingGroupCategory(group)) {
      return normalizeRidingGroupCategory(extractRidingGroupCategoryRaw(group));
    }
    if (group._ownerSportCategory === RUN || group._ownerSportCategory === CYCLE) {
      return group._ownerSportCategory;
    }
    return normalizeRidingGroupCategory(group.category);
  }

  function filterRidingGroupsByBoardCategory(rows, boardCategory) {
    var want = normalizeRidingGroupCategory(boardCategory);
    return (rows || []).filter(function (g) {
      return resolveRidingGroupCategoryFromGroup(g) === want;
    });
  }

  function fetchOwnerSportCategory(uid) {
    var id = uid != null ? String(uid).trim() : '';
    if (!id) return Promise.resolve(null);
    if (Object.prototype.hasOwnProperty.call(ownerCatCache, id)) {
      return Promise.resolve(ownerCatCache[id]);
    }
    if (typeof global.getUserByUid === 'function') {
      return global.getUserByUid(id)
        .then(function (u) {
          var cat = u ? normalizeOwnerSportCategory(u.category || u.sport_category) : null;
          ownerCatCache[id] = cat;
          return cat;
        })
        .catch(function () {
          ownerCatCache[id] = null;
          return null;
        });
    }
    return Promise.resolve(null);
  }

  function enrichRidingGroupsWithOwnerCategory(groups) {
    if (!groups || !groups.length) return Promise.resolve([]);
    return Promise.all(
      groups.map(function (gr) {
        if (hasExplicitRidingGroupCategory(gr)) {
          var resolved = resolveRidingGroupCategoryFromGroup(gr);
          return Promise.resolve(
            Object.assign({}, gr, {
              category: resolved,
              resolvedCategory: resolved,
              categoryExplicit: true
            })
          );
        }
        var owner = gr.createdBy || gr.created_by || '';
        return fetchOwnerSportCategory(owner).then(function (ownerCat) {
          var resolved = ownerCat === RUN ? RUN : CYCLE;
          return Object.assign({}, gr, {
            _ownerSportCategory: ownerCat,
            category: resolved,
            resolvedCategory: resolved,
            categoryExplicit: false
          });
        });
      })
    );
  }

  function clearOwnerCategoryCache() {
    ownerCatCache = Object.create(null);
  }

  global.ridingGroupCategory = {
    RUN: RUN,
    CYCLE: CYCLE,
    normalizeRidingGroupCategory: normalizeRidingGroupCategory,
    extractRidingGroupCategoryRaw: extractRidingGroupCategoryRaw,
    hasExplicitRidingGroupCategory: hasExplicitRidingGroupCategory,
    resolveRidingGroupCategoryFromGroup: resolveRidingGroupCategoryFromGroup,
    filterRidingGroupsByBoardCategory: filterRidingGroupsByBoardCategory,
    enrichRidingGroupsWithOwnerCategory: enrichRidingGroupsWithOwnerCategory,
    clearOwnerCategoryCache: clearOwnerCategoryCache
  };
})(typeof window !== 'undefined' ? window : global);
