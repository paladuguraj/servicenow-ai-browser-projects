function link(scope, element, attrs, controller) {
    // The company list is created and destroyed by ng-if, and scroll events do
    // not bubble, so listen in the capture phase on the widget root.
    var NEAR_END_PX = 40;

    function onScroll(event) {
        var list = event.target;
        if (!list.classList || !list.classList.contains('csat-typeahead'))
            return;
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - NEAR_END_PX)
            scope.$evalAsync(function() { controller.loadMoreCompanies(); });
    }

    element[0].addEventListener('scroll', onScroll, true);
    scope.$on('$destroy', function() {
        element[0].removeEventListener('scroll', onScroll, true);
    });
}
