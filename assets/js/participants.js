function participants_list(participants, api_url, is_teacher, enrollment_statuses) {
  participants.sort(function(a, b) { return a.id.localeCompare(b.id); });

  // Initialize tooltips for filter buttons using tag descriptions (if present)
  function initFilterButtonDescriptions() {
    if (typeof bootstrap === 'undefined' || !bootstrap.Tooltip) return;
    $('.filter-users button.filter-tag').each(function(){
      const $btn = $(this);
      const desc = $btn.attr('data-description');
      // Dispose any leftover popovers/tooltips and clear related attributes
      try { const pop = bootstrap.Popover && bootstrap.Popover.getInstance(this); if (pop) pop.dispose(); } catch (e) {}
      try { const tip = bootstrap.Tooltip && bootstrap.Tooltip.getInstance(this); if (tip) tip.dispose(); } catch (e) {}
      $btn.removeAttr('data-bs-title data-bs-content data-bs-toggle');
      if (!desc || !desc.trim()) return;
      // Set title attribute and init tooltip
      $btn.attr('title', desc);
      try {
        new bootstrap.Tooltip(this, {
          title: desc,
          trigger: 'hover focus',
          placement: 'top',
          container: 'body'
        });
      } catch (e) { /* ignore */ }
    });
  }

  // Helper: read all available tags from filter buttons present in the page
  function getAllPageTags() {
    return $('.filter-users button.filter-tag').map(function(){
      const $b = $(this);
      let id = parseInt($b.attr('data-tagid'), 10);
      if (isNaN(id)) id = null; // hardcoded tags have no numeric id
      return {
        id: id,
        slug: $b.attr('data-tagslug'),
        name: $b.attr('data-tagname') || $b.text().trim(),
        color: $b.attr('data-color'),
        font_color: $b.attr('data-font-color'),
        font_white: $b.attr('data-font-white') === '1'
      };
    }).get();
  }

  // Helper: open Add Tag modal for provided user IDs
  function openAddTagModal(userIds, preselectSlug) {
    // Exclude hardcoded tags (no numeric id) from selectable options
    const allTags = getAllPageTags().filter(function(t){
      return t.id !== null && t.id !== undefined;
    });
    // Compute tags already present in ALL selected users to avoid duplicates
    const selectedParticipants = participants.filter(function(p){ return userIds.indexOf(p.user_id) !== -1; });
    let commonSlugs = null;
    selectedParticipants.forEach(function(p){
      const set = new Set(p.tag_slugs || []);
      if (commonSlugs === null) {
        commonSlugs = new Set(set);
      } else {
        // intersect
        commonSlugs.forEach(function(s){ if (!set.has(s)) commonSlugs.delete(s); });
      }
    });
    const $select = $('#tag-add-select');
    $select.empty();
    allTags.forEach(function(tag){
      const disabled = commonSlugs && commonSlugs.has(tag.slug);
      const $opt = $('<option/>')
        .attr({ value: tag.slug, 'data-tagid': tag.id, 'data-color': tag.color, 'data-font_color': tag.font_color, 'data-font_white': tag.font_white ? '1':'0' })
        .prop('disabled', !!disabled)
        .text(tag.name);
      $select.append($opt);
    });
    if (preselectSlug) {
      $select.val(preselectSlug);
    } else {
      // pick first non-disabled option
      const $firstEnabled = $select.find('option:not([disabled])').first();
      if ($firstEnabled.length) $select.val($firstEnabled.val());
    }
    // Disable confirm if nothing can be selected
    const hasAvailable = $select.find('option:not([disabled])').length > 0;
    $('#tag-add-confirm').prop('disabled', !hasAvailable);
    $('#tag-add-target-count').text(userIds.length);
    // Store target users on confirm button
    $('#tag-add-confirm').data('targetUserIds', userIds);
    const modal = new bootstrap.Modal('#tag-add-modal', {});
    modal.show();
  }

  // Cached tag metadata maps (built from filter buttons present in the page)
  let _tagMapById = null;
  let _tagMapBySlug = null;
  function getTagMapById() {
    if (_tagMapById) return _tagMapById;
    _tagMapById = {};
    _tagMapBySlug = {};
    getAllPageTags().forEach(function(t){
      if (t.id !== null && t.id !== undefined) _tagMapById[t.id] = t; // skip hardcoded tags with no numeric id
      if (t.slug) _tagMapBySlug[t.slug] = t;
    });
    return _tagMapById;
  }
  function getTagMapBySlug() {
    if (_tagMapBySlug) return _tagMapBySlug;
    getTagMapById();
    return _tagMapBySlug;
  }

  function upsertTagMeta(tag) {
    if (!_tagMapById || !_tagMapBySlug) {
      getTagMapById();
    }
    if (tag) {
      if (typeof tag.id === 'number' && !isNaN(tag.id)) {
        _tagMapById[tag.id] = tag;
      }
      if (tag.slug) {
        _tagMapBySlug[tag.slug] = tag;
      }
    }
  }

  function renderTagLabel(tag) {
    try {
      if (typeof django_colortag_label === 'function') {
        return django_colortag_label(tag, { element: 'span', label: true })[0].outerHTML;
      }
    } catch (e) { /* fall through */ }
    // Fallback plain pill
    const style = (tag.color ? 'background-color:' + tag.color + ';' : '') + (tag.font_white ? 'color:#fff;' : '');
    const idAttr = (typeof tag.id === 'number' && !isNaN(tag.id)) ? String(tag.id) : '';
    const slugAttr = tag.slug || '';
    const isHardcoded = (slugAttr === 'user-internal' || slugAttr === 'user-external');
    const removableAttr = isHardcoded ? 'false' : 'true';
    return '<span class="colortag badge rounded-pill" data-tagslug="' + slugAttr + '" data-tagid="' + idAttr + '" data-tag-removable="' + removableAttr + '" style="' + style + '">' + (tag.name || tag.slug || tag.id) + '</span>';
  }

  // Build a union of tag slugs present among provided user ids
  function collectTagSlugsForUsers(userIds) {
    const slugs = new Set();
    participants.forEach(function(p){
      if (userIds.indexOf(p.user_id) !== -1 && Array.isArray(p.tag_slugs)) {
        p.tag_slugs.forEach(function(s){
          if (s !== 'user-internal' && s !== 'user-external') slugs.add(s);
        });
      }
    });
    return Array.from(slugs);
  }

  // Helper: open Remove Tag modal for provided user IDs
  function openRemoveTagModal(userIds) {
    const bySlug = getTagMapBySlug();
    const slugs = collectTagSlugsForUsers(userIds);
    const $select = $('#tag-remove-select');
    $select.empty();
    slugs.forEach(function(slug){
      const meta = bySlug[slug] || { slug: slug, name: slug };
      const $opt = $('<option/>').attr({ value: slug }).text(meta.name || slug);
      $select.append($opt);
    });
    // If none are available, disable confirm
    const hasAny = $select.find('option').length > 0;
    $('#tag-remove-confirm').prop('disabled', !hasAny).data('targetUserIds', userIds);
    $('#tag-remove-target-count').text(userIds.length);
    const modal = new bootstrap.Modal('#tag-remove-modal', {});
    modal.show();
  }

  function renderTagsCell(row) {
    // Merge from both tag_ids and tag_slugs. If either array is present, prefer client rendering
    // and do NOT fallback to legacy pre-rendered HTML even if result is empty (ensures removals show).
    const byId = getTagMapById();
    const bySlug = getTagMapBySlug();
    const bySlugRendered = {};
    let labels = [];
    if (Array.isArray(row.tag_ids) && row.tag_ids.length) {
      row.tag_ids.forEach(function(id){ const t = byId[id]; if (t && t.slug && !bySlugRendered[t.slug]) { labels.push(renderTagLabel(t)); bySlugRendered[t.slug] = true; } });
    }
    if (Array.isArray(row.tag_slugs) && row.tag_slugs.length) {
      row.tag_slugs.forEach(function(slug){ const t = bySlug[slug]; if (t && !bySlugRendered[slug]) { labels.push(renderTagLabel(t)); bySlugRendered[slug] = true; } });
    }
    // If no arrays are present at all, fallback to legacy HTML once
    if (!Array.isArray(row.tag_ids) && !Array.isArray(row.tag_slugs) && typeof row.tags === 'string') {
      return row.tags; // legacy pre-rendered HTML
    }
    return labels.join(' ');
  }

  // Helper: perform API POST to add tag to list of users (bulk with fallback)
  function postAddTaggings(userIds, tagSlug, doneCb) {
    const apiBase = api_url.endsWith('/') ? api_url : (api_url + '/');
    // Chunk into batches of 10 like deletions do
    const chunks = [];
    for (let i = 0; i < userIds.length; i += 10) chunks.push(userIds.slice(i, i + 10));
    let pending = chunks.length;
    const successes = new Set();
    if (pending === 0) { if (doneCb) doneCb([]); return; }

    function finishOne() {
      pending -= 1;
      if (pending === 0 && doneCb) doneCb(Array.from(successes));
    }

    function fallbackPerUser(chunk) {
      const reqs = chunk.map(function(uid){
        return $.ajax({
          type: 'POST',
          url: apiBase + 'taggings/',
          data: JSON.stringify({ user: { id: uid }, tag: { slug: tagSlug } }),
          contentType: 'application/json; charset=utf-8',
          dataType: 'json',
        }).done(function(){ successes.add(uid); });
      });
      $.when.apply($, reqs).always(finishOne);
    }

    chunks.forEach(function(chunk){
      // Try bulk first
      $.ajax({
        type: 'POST',
        url: apiBase + 'taggings/',
        data: JSON.stringify({ tag: { slug: tagSlug }, user_ids: chunk }),
        contentType: 'application/json; charset=utf-8',
        dataType: 'json',
      }).done(function(resp){
        // Determine successful IDs from response; fall back to entire chunk
        let okIds = chunk.slice();
        try {
          if (resp && Array.isArray(resp.errors) && resp.errors.length) {
            const failed = new Set();
            resp.errors.forEach(function(e){
              const uid = (e && e.user && (e.user.id || e.user.user_id)) || null;
              if (uid != null) failed.add(parseInt(uid, 10));
            });
            okIds = chunk.filter(function(id){ return !failed.has(id); });
          } else if (resp && Array.isArray(resp.results) && resp.created !== undefined) {
            // Optionally trust results length if provided
            // Keep okIds as-is; server partials should have been listed in errors
          }
        } catch (e) { /* ignore, use chunk */ }
        okIds.forEach(function(id){ successes.add(id); });
        finishOne();
      }).fail(function(){
        // Fallback to per-user requests if bulk fails (e.g., old API)
        fallbackPerUser(chunk);
      });
    });
  }

  // Helper: perform API DELETE to remove tag from list of users (bulk with fallback)
  function deleteTaggings(userIds, tagSlug, doneCb) {
    const apiBase = api_url.endsWith('/') ? api_url : (api_url + '/');
    const chunks = [];
    for (let i = 0; i < userIds.length; i += 10) chunks.push(userIds.slice(i, i + 10));
    let pending = chunks.length;
    if (pending === 0) { if (doneCb) doneCb([]); return; }
    const successes = new Set();
    function finishOne() {
      pending -= 1;
      if (pending === 0 && doneCb) doneCb(Array.from(successes));
    }
    function fallbackQuery(chunk) {
      const qs = 'tag_slug=' + encodeURIComponent(tagSlug) + '&' + chunk.map(function(id){ return 'user_id=' + encodeURIComponent(id); }).join('&');
      $.ajax({ type: 'DELETE', url: apiBase + 'taggings/?' + qs })
        .done(function(){
          // Legacy endpoint returns 204 with no content on success
          chunk.forEach(function(id){ successes.add(id); });
        })
        .always(function(){ finishOne(); });
    }
    chunks.forEach(function(chunk){
      $.ajax({
        type: 'DELETE',
        url: apiBase + 'taggings/?summary=1',
        data: JSON.stringify({ tag_slug: tagSlug, user_ids: chunk }),
        contentType: 'application/json; charset=utf-8',
        dataType: 'json'
      }).done(function(resp, _statusText, xhr){
        // Prefer server-provided summary when present
        if (xhr && xhr.status === 200 && resp && Array.isArray(resp.deleted_user_ids)) {
          resp.deleted_user_ids.forEach(function(id){ successes.add(parseInt(id, 10)); });
        } else {
          // Assume all chunk succeeded (legacy 204 or 200 without body)
          chunk.forEach(function(id){ successes.add(id); });
        }
        finishOne();
      }).fail(function(){
        // Fallback to query param legacy
        fallbackQuery(chunk);
      });
    });
  }

  // Helper: after successful add, update local state and DOM labels
  function applyAddedTag(userIds, tagSlug) {
    // Find tag meta from filter buttons
    const tagBtn = $('.filter-users button.filter-tag[data-tagslug="' + tagSlug + '"]');
    const tag = {
      id: parseInt(tagBtn.attr('data-tagid'), 10),
      slug: tagSlug,
      name: tagBtn.attr('data-tagname') || tagBtn.text().trim(),
      color: tagBtn.attr('data-color'),
      font_white: tagBtn.attr('data-font-white') === '1'
    };
    // Ensure our metadata cache contains the tag (in case it was missing or stale)
    upsertTagMeta(tag);
    // Update data and refresh UI
  const slugToId = (typeof tag.id === 'number' && !isNaN(tag.id)) ? tag.id : null; // may be null for hardcoded tags
    const $dtTable = $('#table-participants');
    const hasDT = $dtTable.length && $.fn.dataTable && $.fn.dataTable.isDataTable($dtTable);
    let dt = null;
    if (hasDT) dt = $dtTable.DataTable();
    
    userIds.forEach(function(uid){
      const p = participants.find(function(pp){ return pp.user_id === uid; });
      if (!p) return;
      if (!p.tag_slugs) p.tag_slugs = [];
      if (p.tag_slugs.indexOf(tagSlug) === -1) p.tag_slugs.push(tagSlug);
      if (slugToId !== null) {
        if (!Array.isArray(p.tag_ids)) p.tag_ids = [];
        if (p.tag_ids.indexOf(slugToId) === -1) p.tag_ids.push(slugToId);
      }
      if (hasDT) {
        try {
          const rowApi = dt.row('#participant-' + uid);
          if (rowApi && rowApi.data) {
            rowApi.data(p).invalidate();
            // Also update the current DOM immediately as a safety net
            const node = rowApi.node();
            if (node) {
              $(node).find('td.usertags-container .colortag[data-tagslug="' + tagSlug + '"]').remove();
            }
          }
        } catch (e) { /* ignore */ }
      } else {
        // Manual table path: append into DOM as before
        const $container = $('[data-user-id="' + uid + '"]').find('.usertags-container');
        if ($container.length && typeof django_colortag_label === 'function') {
          const $label = django_colortag_label(tag, { element: 'span', label: true });
          $container.append(' ').append($label);
          // Ensure popover is wired for the newly added label
          if (typeof add_colortag_buttons === 'function') {
            add_colortag_buttons(
              api_url,
              document.getElementById('participants'),
              participants
            );
          }
        }
      }
    });
    if (hasDT) {
      // Force immediate redraw, then a microtask revalidation to ensure tags cell updates
      dt.draw(false);
      setTimeout(function(){
        try {
          // Re-invalidate all affected rows' tag cells
          userIds.forEach(function(uid){
            const rowApi = dt.row('#participant-' + uid);
            if (rowApi && rowApi.data) rowApi.invalidate();
          });
          dt.draw(false);
        } catch (e) { /* ignore */ }
      }, 0);
      // Ensure popovers are wired for the newly rendered labels
      if (typeof add_colortag_buttons === 'function') {
        add_colortag_buttons(
          api_url,
          document.getElementById('table-participants'),
          participants
        );
      }
    }
  }

  // Helper: after successful delete, update local state and DOM labels
  function applyRemovedTag(userIds, tagSlug) {
    const bySlug = getTagMapBySlug();
    const tagMeta = bySlug[tagSlug];
    const tagId = tagMeta && typeof tagMeta.id === 'number' && !isNaN(tagMeta.id) ? tagMeta.id : null;
    const byId = getTagMapById();
    const $dtTable = $('#table-participants');
    const hasDT = $dtTable.length && $.fn.dataTable && $.fn.dataTable.isDataTable($dtTable);
    let dt = null;
    if (hasDT) dt = $dtTable.DataTable();

    userIds.forEach(function(uid){
      const p = participants.find(function(pp){ return pp.user_id === uid; });
      if (!p) return;
      // Ensure arrays exist so renderTagsCell uses client rendering, not legacy HTML fallback
      if (!Array.isArray(p.tag_slugs)) p.tag_slugs = [];
      if (!Array.isArray(p.tag_ids)) p.tag_ids = [];
      if (Array.isArray(p.tag_slugs)) {
        const idx = p.tag_slugs.indexOf(tagSlug);
        if (idx > -1) p.tag_slugs.splice(idx, 1);
      }
      if (tagId !== null && Array.isArray(p.tag_ids)) {
        // Remove exact id if known
        const idIdx = p.tag_ids.indexOf(tagId);
        if (idIdx > -1) p.tag_ids.splice(idIdx, 1);
        // Additionally, remove any id whose slug resolves to tagSlug (safety)
        p.tag_ids = p.tag_ids.filter(function(id){
          const meta = byId[id];
          return !(meta && meta.slug === tagSlug);
        });
      } else if (Array.isArray(p.tag_ids)) {
        // No known numeric id; remove any id that maps to this slug
        p.tag_ids = p.tag_ids.filter(function(id){
          const meta = byId[id];
          return !(meta && meta.slug === tagSlug);
        });
      }
      if (hasDT) {
        try {
          const rowApi = dt.row('#participant-' + uid);
          if (rowApi && rowApi.data) {
            rowApi.data(p).invalidate();
            const node = rowApi.node();
            if (node) {
              const $cont = $(node).find('td.usertags-container');
              if ($cont.length && $cont.find('.colortag[data-tagslug="' + tagSlug + '"]').length === 0) {
                const html = renderTagLabel(tag);
                $cont.append($cont.text().trim() ? ' ' : '').append(html);
              }
            }
          }
        } catch (e) { /* ignore */ }
      } else {
        const $container = $('[data-user-id="' + uid + '"]').find('.usertags-container');
        $container.find('.colortag[data-tagslug="' + tagSlug + '"]').remove();
      }
    });
    if (hasDT) dt.draw(false);
    try { $(document).trigger('aplus:tags-changed', { type: 'remove', tag_slug: tagSlug, user_ids: userIds }); } catch (e) {}
  }

  // Confirm remove/ban participant (works for both DataTables and manual table paths)
  function confirm_remove_participant(participant, row, status, label) {
    var remove_participant = function () {
      $.ajax({
        type: 'DELETE',
        url: api_url + '/students/' + participant.user_id + '/?status=' + status,
      }).done(function () {
        participant.enrollment_status = status;
        // If using DataTables, update the row via DT API and redraw
        if ($('#table-participants').length) {
          try {
            const dt = $('#table-participants').DataTable();
            // Try to locate the row by node; fallback to id selector
            let rowApi = dt.row(row);
            if (!rowApi || !rowApi.node || !rowApi.node()) {
              rowApi = dt.row('#participant-' + participant.user_id);
            }
            if (rowApi && rowApi.data) {
              // Update data object and invalidate rendering
              rowApi.data(participant).invalidate().draw(false);
            } else {
              dt.draw(false);
            }
            // Update summary numbers
            const counts = participants.reduce(function (acc, curr) {
              acc[curr.enrollment_status] = (acc[curr.enrollment_status] || 0) + 1;
              return acc;
            }, {});
            $('#active-participants-number').text(counts['ACTIVE'] || 0);
            $('#pending-participants-number').text(counts['PENDING'] || 0);
            $('#removed-participants-number').text(counts['REMOVED'] || 0);
            $('#banned-participants-number').text(counts['BANNED'] || 0);
          } catch (e) { /* no-op */ }
        } else {
          // Manual table path UI updates
          try {
            row.find('.status-container a').text(enrollment_statuses[status]);
            row.find('.actions-container').empty();
          } catch (e) { /* no-op */ }
          if (typeof refresh_filters === 'function') refresh_filters();
          if (typeof refresh_numbers === 'function') refresh_numbers();
        }
      });
    };

    $('#enrollment-remove-modal-remove-title').toggle(status === 'REMOVED');
    $('#enrollment-remove-modal-ban-title').toggle(status === 'BANNED');
    $('#enrollment-remove-modal-remove-description').toggle(status === 'REMOVED');
    $('#enrollment-remove-modal-ban-description').toggle(status === 'BANNED');
    $('#enrollment-remove-modal-user').text(
      participant.first_name + ' ' + participant.last_name + ' (' + (participant.id || participant.username) + ')'
    );
    $('#enrollment-remove-modal-button')
      .text(label)
      .off('click')
      .on('click', remove_participant);
    const enrollmenRemoveModal = new bootstrap.Modal('#enrollment-remove-modal', {});
    enrollmenRemoveModal.show();
  }

  // If DataTables table is present, use it instead of manual DOM building
  if ($('#table-participants').length) {
                // Initialize popover for the newly added label in manual table
                if (typeof add_colortag_buttons === 'function') {
                  add_colortag_buttons(
                    api_url,
                    document.getElementById('participants'),
                    participants
                  );
                }
    const $table = $('#table-participants');

    // Keep selection across pages using a Set of user_ids
    const selectedIds = new Set();

    // Column render helpers
    const renderLink = (text, href) => '<a href="' + href + '">' + (text || '') + '</a>';
    const renderMail = (email, username) => '<a href="mailto:' + (email || '') + '">' + (email || username || '') + '</a>';
    const renderCheckbox = (user_id) => (
      '<input id="students-select-' + user_id + '" type="checkbox" name="students" value="' + user_id + '"' + (selectedIds.has(user_id) ? ' checked' : '') + ' />'
    );

    // Build columns
    const columns = [];
    if (is_teacher) {
      columns.push({
        data: null,
        orderable: false,
        searchable: false,
        className: 'text-center select-box col-1',
        render: function (data, type, row) { return renderCheckbox(row.user_id); }
      });
    }
    columns.push(
      { data: 'id', className: "student-id col-1", render: function(d, t, row){ return renderLink(row.id, row.link); } },
      { data: 'last_name', className: "col-1", render: function(d, t, row){ return renderLink(row.last_name, row.link); } },
      { data: 'first_name', className: "col-2", render: function(d, t, row){ return renderLink(row.first_name, row.link); } },
      { data: null, className: "col-2", render: function(d, t, row){ return renderMail(row.email, row.username); } },
      { data: 'enrollment_status', className: "col-1", render: function(d){ return enrollment_statuses[d] || d; } },
      { data: null, className: "user-tags col-3", orderable: false, searchable: false, render: function(d, t, row){ return renderTagsCell(row); } }
    );
    if (is_teacher) {
      columns.push({ data: null, orderable: false, searchable: false, defaultContent: '', className: 'col-1 actions-container' });
    }

    // Build header (labels + filter inputs) for DataTables
    const $thead = $table.find('thead#table-heading');
    $thead.empty();
    const $labelsRow = $('<tr/>');
    // Helper to add cell
    function addHeader(labelHtml, filterIdx) {
      const $th = $('<th/>').html(labelHtml || '');
      if (typeof filterIdx === 'number') {
        const $inp = $('<input type="text" class="form-control mt-1"/>')
          .attr('data-column', String(filterIdx))
          .attr('placeholder', _('Filter'))
          .attr('aria-label', _('Filter'));
        $th.append($inp);
      }
      $labelsRow.append($th);
    }
    // Column 0: select all (teacher) or ID
    if (is_teacher) {
      addHeader('<input type="checkbox" id="students-select-all" name="students" value="all" />', undefined);
      // Following searchable columns by their DataTables index
      addHeader(_('Student ID'), 1);
      addHeader(_('Last name'), 2);
      addHeader(_('First name'), 3);
      addHeader(_('Email'), 4);
      addHeader(_('Status'), undefined);
      addHeader(_('Tags'), undefined);
      addHeader('', undefined);
    } else {
      addHeader(_('Student ID'), 0);
      addHeader(_('Last name'), 1);
      addHeader(_('First name'), 2);
      addHeader(_('Email'), 3);
      addHeader(_('Status'), undefined);
      addHeader(_('Tags'), undefined);
    }
    $thead.append($labelsRow);

    /**
     * If the body has class 'lang-fi', use the Finnish translation for DataTables
     */
    pageLanguageUrl = $('body').hasClass('lang-fi') ? 'https://cdn.datatables.net/plug-ins/2.2.1/i18n/fi.json' : '';

    /**
     * Removes HTML from Tags and Name columns.
     * The tags column needs special treatment as we need to replace
     * the html tags with commas for exporting. Also Name column needs HTML cleanup.
     * The regexp takes any number of consecutive tags and converts them into a single comma.
     * After that, the first and last commas are sliced away.
     */
    function removeHtmlFromColumns( data, row, column, node ) {
        if (typeof(data) === "string") {
            // Column 4 is expected to be the Tags column
            // The other HTML - rendered columns (name, studentID)
            // are just cleaned up of HTML
            return column === 4 ?
            data.replace( /(<[^>]*>)+/g, ',' ).slice(1,-1) :
            $.fn.dataTable.util.stripHtml(data);
        }
        else return data;
    }

    /**
     * Define common options for DataTables buttons (CSV, Copy, Excel), as they all use the
     * same logic and export only visible columns.
     */
    var buttonCommon = {
        exportOptions: {
            columns: ['Email:name', ':visible'],
            format: {
                body: removeHtmlFromColumns
            }
        }
    }

    // Initialize DataTable
    const dt = $table.DataTable({
      data: participants,
      columns: columns,
      order: [[ is_teacher ? 1 : 0, 'asc' ]],
      orderCellsTop: true,
      rowId: function(row) { return 'participant-' + row.user_id; },
      createdRow: function(row, data /*, dataIndex */) {
        // Tag cell: add container class and user-id for later tag operations
        const tagCellIndex = is_teacher ? 6 : 5;
        const $cells = $('td', row);
        $($cells.get(tagCellIndex))
          .addClass('usertags-container')
          .attr('data-user-id', data.user_id);
        // Row also has data-user-id
        $(row).attr('data-user-id', data.user_id);
      },
      lengthMenu: [[10, 50, 100, 500, -1], [10, 50, 100, 500, "All"]],
      pageLength: 50, // Set the length to 50 for faster initial load time
      deferRender: true,
      autoWidth: false,
      language: {
          url: pageLanguageUrl
      },
      /**
       * Configure the DataTables-generated DOM (order of elements and Bootstrap classes)
       * Note that we have a custom "dt-note" div that is used to display a note about
       * using the < and > operators in number column search fields.
       */
      dom: "<'row'<'col-md-3 col-sm-6'l><'col-md-5 col-sm-6'B><'col-md-4 col-sm-12'f>>" +
              "<'row'<'col-sm-6'i><'col-sm-6 dt-note'>>" +
              "<'row'<'#table-participants-div.col-sm-12'tr>>" +
              "<'row'<'col-sm-5'i><'col-sm-7'p>>",
      /**
       * Data export buttons
       */
        buttons: [
          $.extend( true, {}, buttonCommon, {
              extend: 'csvHtml5'
          } ),
          $.extend( true, {}, buttonCommon, {
              extend: 'copyHtml5'
          } ),
          $.extend( true, {}, buttonCommon, {
              extend: 'excelHtml5'
          } )
      ]
    });

    // Wire header inputs to DataTables column-specific search
    (function(){
      function debounce(fn, delay){ let t; return function(){ const ctx=this, args=arguments; clearTimeout(t); t=setTimeout(function(){ fn.apply(ctx,args); }, delay); }; }
      const doSearch = debounce(function(input){
        const $inp = $(input);
        const colIdx = parseInt($inp.data('column'), 10);
        const val = $inp.val();
        if (!isNaN(colIdx)) dt.column(colIdx).search(val).draw(false);
      }, 200);
      $table.on('input.aplusDTsearch change.aplusDTsearch', 'thead#table-heading input[type="text"]', function(){ doSearch(this); });
      // Prevent header click-to-sort when interacting with filter controls
      $table.on('click.aplusDTstop mousedown.aplusDTstop mouseup.aplusDTstop dblclick.aplusDTstop keydown.aplusDTstop',
        'thead#table-heading input, thead#table-heading select',
        function(e){ e.stopPropagation(); }
      );
      // Also add native capturing listeners to intercept before DataTables gets the event
      const theadEl = $table.find('thead#table-heading').get(0);
      if (theadEl && theadEl.addEventListener) {
        const stopIfFilterCtrl = function(e){
          const t = e.target;
          if (t && (t.closest && t.closest('input, select, textarea'))) {
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            e.stopPropagation();
          }
        };
        ['click','mousedown','mouseup','dblclick','keydown','pointerdown','touchstart'].forEach(function(ev){
          theadEl.addEventListener(ev, stopIfFilterCtrl, true);
        });
      }
    })();

    // Cache current filter selections to avoid heavy DOM queries per row
    let currentFilterTags = [];
    let currentFilterStatuses = [];
    function recomputeFilters() {
      currentFilterTags = $('.filter-users button.filter-tag').filter(function(){
        return $(this).find('i').hasClass('bi-check-square');
      }).map(function(){ return $(this).attr('data-tagslug'); }).get();
      currentFilterStatuses = $('.filter-users button.filter-status').filter(function(){
        return $(this).find('i').hasClass('bi-check-square');
      }).map(function(){ return $(this).attr('data-status'); }).get();
    }
    // Initialize once
    recomputeFilters();

    // Custom filtering based on tag/status buttons
    const filterFn = function(settings, _data, dataIndex) {
      if (settings.nTable !== $table.get(0)) return true; // only for our table
      const rowData = dt.row(dataIndex).data();
      // Normalize tags to slugs for filtering: merge existing slugs with those derived from tag_ids
      if (Array.isArray(rowData.tag_ids)) {
        const byId = getTagMapById();
        const derived = rowData.tag_ids.map(function(id){ return byId[id] ? byId[id].slug : null; }).filter(Boolean);
        const existing = Array.isArray(rowData.tag_slugs) ? rowData.tag_slugs.slice() : [];
        // Merge unique
        const set = new Set(existing.concat(derived));
        rowData.tag_slugs = Array.from(set);
      }
      // Tag intersection: all selected tags must be in row's tag_slugs
      const intersectTags = (rowData.tag_slugs || []).filter(function (tag) { return currentFilterTags.indexOf(tag) >= 0; });
      const tagsOk = intersectTags.length === currentFilterTags.length;
      const statusOk = (currentFilterStatuses.length === 0) || (currentFilterStatuses.indexOf(rowData.enrollment_status) >= 0);
      return tagsOk && statusOk;
    };
    // Register once per table instance
    if (!$table.data('aplusFilterRegistered')) {
      $.fn.dataTable.ext.search.push(filterFn);
      $table.data('aplusFilterRegistered', true);
    }

    // Hook up filter buttons
    $('.filter-users button').off('click.aplusFilters').on('click.aplusFilters', function(event) {
      event.preventDefault();
      var icon = $(this).find('i');
      if (icon.hasClass('bi-square')) {
        icon.removeClass('bi-square').addClass('bi-check-square');
      } else {
        icon.removeClass('bi-check-square').addClass('bi-square');
      }
      // Recompute active filters once per click
      recomputeFilters();
      // Redraw once after toggling, throttle multiple rapid clicks
      if (dt._aplusRedrawTimer) clearTimeout(dt._aplusRedrawTimer);
      dt._aplusRedrawTimer = setTimeout(function(){ dt.draw(false); }, 0);
      // Hide tooltip if open
      try {
        if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
          const tip = bootstrap.Tooltip.getInstance(this);
          if (tip) tip.hide();
        }
      } catch (e) { /* ignore */ }
    });

    // Initialize description popovers for filter buttons
    initFilterButtonDescriptions();

    // Selection behavior (teacher only)
    if (is_teacher) {
      const $all_box = $('#students-select-all');

      function filteredUserIds() {
        // All rows matching current filters (across pages)
        const data = dt.rows({ search: 'applied', page: 'all' }).data();
        const ids = [];
        for (let i = 0; i < data.length; i++) ids.push(data[i].user_id);
        return ids;
      }

      function updateHeaderAndGlobal() {
        const ids = filteredUserIds();
        let selectedFiltered = 0;
        ids.forEach(function(id){ if (selectedIds.has(id)) selectedFiltered++; });
        const totalFiltered = ids.length;
        const allChecked = totalFiltered > 0 && selectedFiltered === totalFiltered;
        const atLeastOne = selectedFiltered > 0 && selectedFiltered < totalFiltered;
        $all_box.prop('checked', allChecked);
        $all_box.prop('indeterminate', atLeastOne);
        // Show selected among filtered
        $('#selected-number').text(selectedFiltered);
        $('#add-tag-selected').prop('disabled', selectedFiltered === 0);
        $('#remove-tag-selected').prop('disabled', selectedFiltered === 0);
      }

      // Toggle per-row checkbox updates selection store
      $table.on('change', 'input[type="checkbox"][name="students"]', function(){
        const uid = parseInt(this.value, 10);
        if (this.checked) selectedIds.add(uid); else selectedIds.delete(uid);
        updateHeaderAndGlobal();
      });

      // Select all filtered across all pages
      $all_box.off('change.aplusSelectAll').on('change.aplusSelectAll', function () {
        const ids = filteredUserIds();
        if ($all_box.prop('checked')) {
          ids.forEach(function(id){ selectedIds.add(id); });
        } else {
          ids.forEach(function(id){ selectedIds.delete(id); });
        }
        // Update visible page checkboxes to reflect new state
        $(dt.rows({ page: 'current' }).nodes()).find('input[type="checkbox"][name="students"]').each(function(){
          const uid = parseInt(this.value, 10);
          $(this).prop('checked', selectedIds.has(uid));
        });
        updateHeaderAndGlobal();
        return false;
      });

      // On every draw, sync checkboxes to selection store and update header/global
      dt.on('draw', function(){
        $(dt.rows({ page: 'current' }).nodes()).find('input[type="checkbox"][name="students"]').each(function(){
          const uid = parseInt(this.value, 10);
          $(this).prop('checked', selectedIds.has(uid));
        });
        updateHeaderAndGlobal();
      });
    }

    // After translations are ready, add tag popovers/buttons and actions
    $(document).off('aplus:translation-ready.aplusTags').on('aplus:translation-ready.aplusTags', function () {
      add_colortag_buttons(
        api_url,
        document.getElementById('table-participants'),
        participants
      );
        // Reinitialize popovers on every DT redraw to cover newly rendered labels
        if (dt && typeof dt.on === 'function' && !dt._aplusTagDrawHandler) {
          dt.on('draw.aplusTagPopovers', function(){
            add_colortag_buttons(
              api_url,
              document.getElementById('table-participants'),
              participants
            );
          });
          dt._aplusTagDrawHandler = true;
        }
      if (is_teacher) {
        // Populate actions column on draw
        const renderActionBtn = function(label, icon, onClick, extraClasses){
          return $('<button></button>')
            .append($('<i></i>').addClass('bi-' + icon).attr('aria-hidden', true))
            .append(' ' + label)
            .addClass((extraClasses || 'aplus-button--danger aplus-button--xs'))
            .on('click', onClick);
        };
        dt.on('draw.aplusActions', function(){
          dt.rows({page:'current'}).every(function(){
            const row = this.data();
            const $node = $(this.node());
            const $cell = $node.find('td.actions-container');
            if ($cell.children().length) return; // already populated
            const rowRef = $node; // for closures
            const actions = $('<div/>');
            actions.append(
              renderActionBtn(_('Remove'), 'x-lg', function(){
                confirm_remove_participant(row, rowRef, 'REMOVED', _('Remove'));
              })
            ).append(' ').append(
              renderActionBtn(_('Ban'), 'dash-circle-fill', function(){
                confirm_remove_participant(row, rowRef, 'BANNED', _('Ban'));
              })
            );
            $cell.empty().append(actions);

            // Add "Add tag" inline button into the Tags column
            const $tagsCell = $node.find('td.usertags-container');
            if ($tagsCell.length && !$tagsCell.find('.add-tag-inline').length) {
              const $btn = $('<button type="button" />')
                .addClass('add-tag-inline aplus-button--primary aplus-button--xs ms-1')
                .append($('<i/>').addClass('bi-tag').attr('aria-hidden', true))
                .append(' ' + _('Add new tagging'))
                .on('click', function(){ openAddTagModal([row.user_id]); });
              $tagsCell.append(' ').append($btn);
            }
          });
        });
        dt.draw(false);
        // Global "Add tag to selected" button
        const $globalBtn = $('#add-tag-selected');
        $globalBtn.off('click.aplusAddSel').on('click.aplusAddSel', function(){
          // Use selection among filtered rows
          const ids = [];
          const filtered = dt.rows({ search: 'applied', page: 'all' }).data();
          for (let i = 0; i < filtered.length; i++) {
            const uid = filtered[i].user_id;
            if (selectedIds.has(uid)) ids.push(uid);
          }
          if (ids.length) openAddTagModal(ids);
        });
        // Global "Remove tag from selected" button
        const $globalRmBtn = $('#remove-tag-selected');
        $globalRmBtn.off('click.aplusRmSel').on('click.aplusRmSel', function(){
          const ids = [];
          const filtered = dt.rows({ search: 'applied', page: 'all' }).data();
          for (let i = 0; i < filtered.length; i++) {
            const uid = filtered[i].user_id;
            if (selectedIds.has(uid)) ids.push(uid);
          }
          if (ids.length) openRemoveTagModal(ids);
        });
      }
    });

    // When tags change (e.g., removed via popover), refresh the table filtering
    $(document).off('aplus:tags-changed.aplusDT').on('aplus:tags-changed.aplusDT', function(){
      // Redraw to apply current filter state
      if (dt._aplusRedrawTimer) clearTimeout(dt._aplusRedrawTimer);
      dt._aplusRedrawTimer = setTimeout(function(){ dt.draw(false); }, 0);
    });

    // Confirm in modal: perform POST and update UI
    $('#tag-add-confirm').off('click.aplusConfirm').on('click.aplusConfirm', function(){
      const userIds = $(this).data('targetUserIds') || [];
      const tagSlug = $('#tag-add-select').val();
      if (!tagSlug || !userIds.length) return;
      postAddTaggings(userIds, tagSlug, function(successIds){
        if (Array.isArray(successIds) && successIds.length) {
          applyAddedTag(successIds, tagSlug);
        }
        // Close modal
        const m = bootstrap.Modal.getInstance(document.getElementById('tag-add-modal'));
        if (m) m.hide();
      });
    });

    // Confirm in modal: perform DELETE and update UI (DataTables path)
    $('#tag-remove-confirm').off('click.aplusRmConfirmDT').on('click.aplusRmConfirmDT', function(){
      const userIds = $(this).data('targetUserIds') || [];
      const tagSlug = $('#tag-remove-select').val();
      if (!tagSlug || !userIds.length) return;
      deleteTaggings(userIds, tagSlug, function(successIds){
        if (Array.isArray(successIds) && successIds.length) applyRemovedTag(successIds, tagSlug);
        const m = bootstrap.Modal.getInstance(document.getElementById('tag-remove-modal'));
        if (m) m.hide();
      });
    });

    return; // DataTables path handled; stop here
  }

  function get_participants() {
    return $('#participants').children();
  }

  if (is_teacher) {
    create_tagging_dropdown =
      get_create_tagging_dropdown_closure({ api_url: api_url });
    get_users_for_user = function (user_id) {
      // If this user's box is not checked, return this user.
      // Else, return all checked users.
      return function () {
        const $user_box = get_participants()
          .find('#students-select-' + user_id);
        if (!$user_box.prop('checked')) {
          return [user_id]
        } else {
          const checked = $.makeArray(get_participants()
            .find('input:checked'));
          return checked.map(function (box) {
            return parseInt(box.getAttribute('value'), 10);
          });
        }
      }
    }
    extra_click_handler = function (data) {
      // Append tag id to participant's tag_ids
      participants
        .find(function (p) { return p.user_id === data.user.id; })
        .tag_slugs.push(data.tag.slug);
    }
  }

  var filter_items = function (participants) {
    const filterTags = $.makeArray($('.filter-users button.filter-tag:has(.bi-check-square)'))
      .map(function (elem) {
        return $(elem).attr('data-tagslug');
      });
    const filterStatuses = $.makeArray($('.filter-users button.filter-status:has(.bi-check-square)'))
      .map(function (elem) {
        return $(elem).attr('data-status');
      });
    return participants.map(function (participant) {
      // Set intercetion tags ∩ filters
      const intersectTags = participant.tag_slugs.filter(function (tag) {
        return filterTags.indexOf(tag) >= 0;
      });
      return intersectTags.length === filterTags.length
        && (filterStatuses.length === 0 || filterStatuses.indexOf(participant.enrollment_status) >= 0);
    });
  };

  

  var get_row_action = function (label, icon, action) {
    return $('<button></button>')
      .append(
        $('<i></i>')
        .addClass('bi-' + icon)
        .attr('aria-hidden', true)
      )
      .append(" " + label)
      .addClass('aplus-button--danger')
      .addClass('aplus-button--xs')
      .on('click', action);
  };

  var refresh_filters = function () {
    const show = filter_items(participants);
    participants.forEach(function (participant, i) {
      const $row = $('tr#participant-' + participant.user_id);
      if (show[i]) {
        $row.removeClass('d-none');
      } else {
        $row.addClass('d-none');
      }
    });
  };

  var refresh_numbers = function () {
    const counts = participants.reduce(function (acc, curr) {
      return acc[curr.enrollment_status] ? ++acc[curr.enrollment_status] : acc[curr.enrollment_status] = 1, acc
    }, {})
    $('#active-participants-number').text(counts['ACTIVE'] || 0);
    $('#pending-participants-number').text(counts['PENDING'] || 0);
    $('#removed-participants-number').text(counts['REMOVED'] || 0);
    $('#banned-participants-number').text(counts['BANNED'] || 0);
  };

  get_participants().remove();
  var deferredRowActions = [];
  participants.forEach(function(participant) {
    const user_id = participant.user_id;
    const tags_id = 'tags-' + user_id;
    const row = $('<tr></tr>')
      .attr({ id: 'participant-' + user_id, 'data-user-id': user_id })
      .appendTo('tbody');
    var link = $('<a></a>').attr('href', participant.link);
    var maillink = $('<a></a>').attr('href', 'mailto:' + participant.email);
    if (is_teacher) {
      $('<td></td>').append(
        $('<input>').attr({
          id: 'students-select-' + user_id,
          type: 'checkbox',
          name: 'students',
          value: user_id,
        })
      ).appendTo(row);
    }
    $('<td></td>')
      .append(link.clone().text(participant.id))
      .appendTo(row);
    $('<td></td>')
      .append(link.clone().text(participant.last_name))
      .appendTo(row);
    $('<td></td>')
      .append(link.clone().text(participant.first_name))
      .appendTo(row);
    $('<td></td>').append(
      maillink.clone().text(participant.email || participant.username)
    ).appendTo(row);
    $('<td></td>')
      .addClass('status-container')
      .append(
      link.clone().text(enrollment_statuses[participant.enrollment_status])
    ).appendTo(row);
    $('<td></td>')
      .addClass('usertags-container')
      .attr({ 'data-user-id': participant.user_id })
      .html(participant.tags)
      .appendTo(row);
    var actionsColumn = $('<td></td>')
      .addClass('actions-container');
    if (participant.enrollment_status == 'ACTIVE') {
      // Don't add the buttons before translations are ready
      // Store them in an array and wait
      deferredRowActions.push(function() {
        // Add Tag button
        actionsColumn.append(
          get_row_action(_('Add new tagging'), 'tag', function(){ openAddTagModal([participant.user_id]); })
            .removeClass('aplus-button--danger').addClass('aplus-button--primary')
        ).append(' ');
        actionsColumn.append(
          get_row_action(_('Remove'), 'x-lg', function () {
            confirm_remove_participant(participant, row, 'REMOVED', _('Remove'));
          })
        ).append(' ').append(
          get_row_action(_('Ban'), 'dash-circle-fill', function () {
            confirm_remove_participant(participant, row, 'BANNED', _('Ban'));
          })
        );
      });
    }
    actionsColumn.appendTo(row);
  });

  if (is_teacher) {
    // Toggle select all checkbox status automatically
    const $all_box = $('#students-select-all');
    const $individual_boxes = get_participants().find('input:checkbox');

    $all_box.prop('checked', false);

    function set_checkbox_status() {
      const $checked_boxes = $individual_boxes.filter(':checked');
      const at_least_one_checked = $individual_boxes.is(':checked');
      const all_checked = $individual_boxes.length === $checked_boxes.length;
      $all_box.prop('checked', all_checked);
      $all_box.prop('indeterminate', at_least_one_checked && !all_checked);
      $('#selected-number').text($checked_boxes.length);
      $('#add-tag-selected').prop('disabled', $checked_boxes.length === 0);
      $('#remove-tag-selected').prop('disabled', $checked_boxes.length === 0);
      return false;
    }

    $individual_boxes.on('change', set_checkbox_status);
    $all_box.on('change', function () {
      $individual_boxes.filter(function (i, elem) {
        return $(elem).parent().parent().is(':not(.hidden)');
      }).prop('checked', $all_box.prop('checked'));
      return set_checkbox_status()
    });

    $(document).on('aplus:translation-ready', function () {
      add_colortag_buttons(
        api_url,
        document.getElementById('participants'),
        participants
      );
      deferredRowActions.forEach(function(deferredRowAction) {
        deferredRowAction();
      });
    });

    // Confirm in modal: perform POST and update UI (manual table)
    $('#tag-add-confirm').off('click.aplusConfirm').on('click.aplusConfirm', function(){
      // In manual table, target users are set when opening modal via global button
      const userIds = $(this).data('targetUserIds') || [];
      const tagSlug = $('#tag-add-select').val();
      if (!tagSlug) return;
      // If not set, fallback to currently checked users
      let ids = userIds;
      if (!ids.length) {
        ids = get_participants().find('input:checkbox:checked').map(function(){ return parseInt(this.value, 10); }).get();
      }
      if (!ids.length) return;
      postAddTaggings(ids, tagSlug, function(successIds){
        if (Array.isArray(successIds) && successIds.length) {
          applyAddedTag(successIds, tagSlug);
        }
        const m = bootstrap.Modal.getInstance(document.getElementById('tag-add-modal'));
        if (m) m.hide();
      });
    });
    // Confirm in modal: perform DELETE and update UI (manual table)
    $('#tag-remove-confirm').off('click.aplusRmConfirm').on('click.aplusRmConfirm', function(){
      const userIds = $(this).data('targetUserIds') || [];
      let ids = userIds;
      if (!ids.length) {
        ids = get_participants().find('input:checkbox:checked').map(function(){ return parseInt(this.value, 10); }).get();
      }
      const tagSlug = $('#tag-remove-select').val();
      if (!tagSlug || !ids.length) return;
      deleteTaggings(ids, tagSlug, function(successIds){
        if (Array.isArray(successIds) && successIds.length) applyRemovedTag(successIds, tagSlug);
        const m = bootstrap.Modal.getInstance(document.getElementById('tag-remove-modal'));
        if (m) m.hide();
      });
    });
  }

  $('.filter-users button').on('click', function(event) {
    event.preventDefault();
    var icon = $(this).find('i');
    if (icon.hasClass('bi-square')) {
      icon.removeClass('bi-square').addClass('bi-check-square');
    } else {
      icon.removeClass('bi-check-square').addClass('bi-square');
    }
    refresh_filters();
    // Hide tooltip if open
    try {
      if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
        const tip = bootstrap.Tooltip.getInstance(this);
        if (tip) tip.hide();
      }
    } catch (e) { /* ignore */ }
  });

  // Initialize description popovers for filter buttons (manual table path)
  initFilterButtonDescriptions();

  // Global "Add tag to selected" button handler (manual table)
  $('#add-tag-selected').off('click.aplusAddSel').on('click.aplusAddSel', function(){
    const ids = get_participants().find('input:checkbox:checked').map(function(){ return parseInt(this.value, 10); }).get();
    if (ids.length) openAddTagModal(ids);
  });
  // Global "Remove tag from selected" button handler (manual table)
  $('#remove-tag-selected').off('click.aplusRmSel').on('click.aplusRmSel', function(){
    const ids = get_participants().find('input:checkbox:checked').map(function(){ return parseInt(this.value, 10); }).get();
    if (ids.length) openRemoveTagModal(ids);
  });

  refresh_filters();
  refresh_numbers();
}
