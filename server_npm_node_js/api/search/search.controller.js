import { Router } from "express";
import SearchService from "./search.service.js"
import ResObject from "../../core/util/res-object.js";
const router = Router();

export default router;

router.post('', search)
router.post('/negotiatedSearch', negotiatedSearch)
router.post('/serviceNameSearch', serviceNameSearch)
router.post('/serviceLocationSearch', serviceLocationSearch)

function search(req, res, next) {
  const body = req.body ?? {}
    SearchService.search(body)
    .then((obj) => {
        new ResObject(res, obj);
      })
      .catch(next);
}

function negotiatedSearch(req, res, next) {
  const body = req.body ?? {}
  SearchService.negotiatedSearch(body)
  .then((obj) => {
      new ResObject(res, obj);
    })
    .catch(next);
}

function serviceNameSearch(req, res, next) {
  const body = req.body ?? {}
  SearchService.serviceNameSearch(body)
  .then((obj) => {
      new ResObject(res, obj);
    })
    .catch(next);
}

function serviceLocationSearch(req, res, next) {
  const body = req.body ?? {}
  SearchService.serviceLocationSearch(body)
  .then((obj) => {
      new ResObject(res, obj);
    })
    .catch(next);
}