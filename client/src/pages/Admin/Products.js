
import React, { useState, useEffect } from "react";
import AdminMenu from "../../components/Layout/AdminMenu";
import Layout from "./../../components/Layout/Layout";
import axios from "axios";
import toast from "react-hot-toast";
import { Link, Navigate } from "react-router-dom";
import { BiEdit } from 'react-icons/bi';
import { RiDeleteBin6Line } from 'react-icons/ri';
import { useAuth } from "../../context/auth";
const Products = () => {
  const [products, setProducts] = useState([]);
  const [auth] = useAuth();

  useEffect(() => {
    if (auth?.token) getAllProducts();
  }, [auth?.token]);

  //getall products
  const getAllProducts = async () => {
    try {
      const { data } = await axios.get("/api/v1/product/get-product");
      setProducts(data.products);

    } catch (error) {
      console.log(error);
      toast.error("Someething Went Wrong");
    }
  };


  const handleDelete = async (id) => {
    try {
      let answer = window.prompt("Are You Sure want to delete this product ? ");
      if (!answer) return;
      const { data } = await axios.delete(
        `/api/v1/product/delete-product/${id}`
      );
      toast.success("Product DEleted Succfully");
      getAllProducts()
    } catch (error) {
      console.log(error);
      toast.error("Something went wrong");
    }
  };

  return (
    <Layout>
      <div className="adminDashboard">
        <div className="container">
          <div className="row">
            <div className="col-md-3 m-0 p-0">
              <AdminMenu />
            </div>
            <div className="col-md-9  ">
              <div className="card shadow p-4">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Image</th>
                      <th>Name</th>
                      <th>Description</th>
                      <th>Price</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products?.map((p) => (
                      <tr className=" p-2 mb-2  rounded">
                        <td>
                          <img
                            src={`/api/v1/product/product-photo/${p._id}`}
                            alt={p.name}
                            width={"60px"}
                            height={"60px"}
                          /></td>
                        <td ><p className="fw-bold pt-2"> {p.name} </p></td>
                        <td ><p className="fw-bold pt-2"> {(p.description).slice(0, 25)} </p></td>
                        <td><p className="brown fw-bold pt-2"> ${p.price} </p></td>
                        <td>
                          <div className="d-flex">
                            <Link
                              style={{ cursor: 'pointer', fontSize: '18px' }}
                              key={p._id}
                              to={`/dashboard/admin/product/${p.slug}`}
                              className=""
                            >
                              <BiEdit />
                            </Link>
                            <p className="text-danger" style={{ cursor: 'pointer', fontSize: '18px' }} onClick={() => handleDelete(p._id)} ><RiDeleteBin6Line /></p>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Products;